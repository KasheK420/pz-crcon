--[[
    PZCrcon (main)
    ==============
    Entry point wired to `Events.OnServerStarted`. Owns:

      - position sampler (every `tickMs` ms, default 5 s)
      - heartbeat emitter (every `heartbeatMs` ms, default 30 s)
      - outbox queue for `PZCrcon_Events` event rows
      - batched HMAC-signed POST to the panel webhook
      - lightweight TPS estimate (ticks/sec moving average)

    Every module load prints a `[PZCrcon]` banner so operators can
    confirm the mod is live from the PZ server console.
]]

require "PZCrcon_Config"
require "PZCrcon_Json"
require "PZCrcon_Hmac"
require "PZCrcon_Http"
require "PZCrcon_Events"

PZCrcon_Main = PZCrcon_Main or {}

local outbox = {}
local lastFlushMs = 0
local lastHeartbeatMs = 0

-- TPS estimator: sliding window of tick timestamps over the last 10 s.
local tickWindow = {}
local TPS_WINDOW_MS = 10000

local function nowMs()
    local ln = rawget(_G, "luanet")
    if ln and type(ln.import_type) == "function" then
        local ok, System = pcall(ln.import_type, "java.lang.System")
        if ok then return tonumber(tostring(System:currentTimeMillis())) end
    end
    return 0
end

local function recordTick(ms)
    tickWindow[#tickWindow + 1] = ms
    local cutoff = ms - TPS_WINDOW_MS
    while tickWindow[1] and tickWindow[1] < cutoff do
        table.remove(tickWindow, 1)
    end
end

local function estimateTps()
    if #tickWindow < 2 then return nil end
    local span = tickWindow[#tickWindow] - tickWindow[1]
    if span <= 0 then return nil end
    return (#tickWindow - 1) * 1000 / span
end

function PZCrcon_Main.enqueueEvent(ev)
    local cfg = PZCrcon_Config.get()
    if #outbox >= cfg.maxEventsPerPost * 4 then
        -- Outbox overflow — drop oldest so we stay bounded when the
        -- panel is offline for a long time.
        table.remove(outbox, 1)
    end
    outbox[#outbox + 1] = ev
end

local function collectPositions(cfg)
    local positions = {}
    local ok, players = pcall(getOnlinePlayers)
    if not ok or not players then return positions end

    local size = 0
    if players.size then size = players:size() else size = #players end
    for i = 0, (size - 1) do
        local p = players.get and players:get(i) or players[i + 1]
        if p then
            local okMeta, name = pcall(function() return p:getUsername() end)
            local okSt, steamId = pcall(function() return tostring(p:getSteamID() or "") end)
            local okX, x = pcall(function() return p:getX() end)
            local okY, y = pcall(function() return p:getY() end)
            local okZ, z = pcall(function() return p:getZ() end)
            if cfg.includeInvisible or (p.isInvisible == nil or not p:isInvisible()) then
                if okMeta and name and okX and okY then
                    local entry = {
                        steamId = (okSt and steamId) or ("pending:" .. name),
                        name = name,
                        x = x,
                        y = y,
                        z = okZ and z or 0,
                    }
                    local okH, hp = pcall(function() return p:getBodyDamage():getHealth() end)
                    if okH and hp then entry.health = hp / 100.0 end
                    local okHg, hg = pcall(function() return p:getStats():getHunger() end)
                    if okHg and hg then entry.hunger = hg end
                    local okTh, th = pcall(function() return p:getStats():getThirst() end)
                    if okTh and th then entry.thirst = th end
                    local okFt, ft = pcall(function() return p:getStats():getFatigue() end)
                    if okFt and ft then entry.fatigue = ft end
                    positions[#positions + 1] = entry
                end
            end
        end
    end
    return positions
end

local function buildHeartbeat(playersOnline)
    local hb = {
        uptimeSec = math.floor(nowMs() / 1000),
        playersOnline = playersOnline,
    }
    local tps = estimateTps()
    if tps then hb.tps = tps end
    local okDay, gt = pcall(function() return getGameTime() end)
    if okDay and gt then
        local okD, day = pcall(function() return gt:getNightsSurvived() end)
        if okD and day then hb.day = day end
        local okH, hour = pcall(function() return gt:getHour() end)
        local okM, min = pcall(function() return gt:getMinutes() end)
        if okH and okM and hour and min then
            hb.hourMin = math.floor(hour * 60 + min)
        end
    end
    return hb
end

local function flush(now)
    local cfg = PZCrcon_Config.get()
    if not PZCrcon_Config.isConfigured() then return end

    local wantsHeartbeat = (now - lastHeartbeatMs) >= cfg.heartbeatMs
    local wantsPositions = (now - lastFlushMs) >= cfg.tickMs
    if not wantsHeartbeat and not wantsPositions and #outbox == 0 then
        return
    end

    local positions = wantsPositions and collectPositions(cfg) or {}
    local batch = {}
    local count = math.min(#outbox, cfg.maxEventsPerPost)
    for i = 1, count do batch[i] = outbox[i] end
    for _ = 1, count do table.remove(outbox, 1) end

    local payload = {
        schema = 1,
        serverId = cfg.serverId,
        sentAt = now,
        positions = positions,
        events = batch,
    }
    if wantsHeartbeat then
        payload.heartbeat = buildHeartbeat(#positions)
        lastHeartbeatMs = now
    end
    if wantsPositions then lastFlushMs = now end

    local body = PZCrcon_Json.encode(payload)
    local sig = PZCrcon_Hmac.sha256(cfg.secret, body)
    if not sig then
        if cfg.enableDebug then
            print("[PZCrcon] HMAC unavailable — dropping payload")
        end
        return
    end
    local headers = {
        ["X-Pz-Signature"] = "sha256=" .. sig,
        ["X-Pz-Secret-Rev"] = "current",
    }
    PZCrcon_Http.postAsync(cfg.endpoint, body, headers, function(ok, code, err)
        if cfg.enableDebug then
            print(string.format(
                "[PZCrcon] POST ok=%s code=%s err=%s positions=%d events=%d",
                tostring(ok), tostring(code), tostring(err or ""),
                #positions, #batch
            ))
        end
    end)
end

local tickGate = 0
local function onTick()
    local now = nowMs()
    recordTick(now)
    -- Throttle the flush-decision work to once per second so OnTick
    -- itself stays cheap (PZ fires this ~20–60x/sec).
    if now - tickGate < 1000 then return end
    tickGate = now
    flush(now)
end

local function onServerStarted()
    print("[PZCrcon] Companion mod booting — endpoint=" ..
        tostring(PZCrcon_Config.get().endpoint))
    if not PZCrcon_Config.isConfigured() then
        print("[PZCrcon] WARNING: secret still default. Fill in " ..
            "Zomboid/Server/PZCrcon.cfg and /reloadlua this mod.")
    end
    PZCrcon_Events.install()
    lastFlushMs = nowMs()
    lastHeartbeatMs = nowMs()
end

if Events then
    if Events.OnServerStarted then Events.OnServerStarted.Add(onServerStarted) end
    if Events.OnTick then Events.OnTick.Add(onTick) end
end

return PZCrcon_Main
