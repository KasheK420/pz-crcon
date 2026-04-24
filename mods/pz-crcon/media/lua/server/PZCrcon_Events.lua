--[[
    PZCrcon_Events
    ==============
    Subscribes to the PZ server events we care about and pushes
    structured event rows into the shared outbox queue
    (`PZCrcon_Main.enqueueEvent`). The main loop then batches and
    ships the queue in one POST per tick.

    Event shape matches the Phase 4 webhook contract:
        { kind, ts, steamId?, name?, x?, y?, z?, region?, day?, meta? }

    Kinds: join · leave · death · heli · chat · generator · gunshot
]]

PZCrcon_Events = PZCrcon_Events or {}

local function now()
    -- Real wall-clock time (ms since epoch). Java is the most
    -- dependable source on a PZ server.
    local ln = rawget(_G, "luanet")
    if ln and type(ln.import_type) == "function" then
        local ok, System = pcall(ln.import_type, "java.lang.System")
        if ok then return tonumber(tostring(System:currentTimeMillis())) end
    end
    return (os.time and os.time() or 0) * 1000
end

local function playerRegion(p)
    if not p then return nil end
    local ok, region = pcall(function()
        local rg = getWorld and getWorld():getMeta() and getWorld():getMeta():getRegionName()
        return rg
    end)
    if ok and region then return region end
    -- Fallback: attempt known API
    local ok2, current = pcall(function() return p:getCurrentRegion() end)
    if ok2 then return current end
    return nil
end

local function base(p, extraKind)
    local b = { kind = extraKind, ts = now() }
    if p and p.getOnlineID then
        b.steamId = tostring(p:getSteamID() or "")
        b.name = p:getUsername() or "unknown"
        local ok, x, y, z = pcall(function() return p:getX(), p:getY(), p:getZ() end)
        if ok then
            b.x = x
            b.y = y
            b.z = z
        end
        b.region = playerRegion(p)
    end
    return b
end

local function pushOrSkip(ev)
    if PZCrcon_Main and PZCrcon_Main.enqueueEvent then
        PZCrcon_Main.enqueueEvent(ev)
    end
end

local function onPlayerConnected(p)
    pushOrSkip(base(p, "join"))
end

local function onPlayerDisconnected(p)
    pushOrSkip(base(p, "leave"))
end

local function onPlayerDeath(p)
    local ev = base(p, "death")
    -- Best-effort death cause.
    local cause = "unknown"
    if p and p.getBodyDamage then
        local bd = p:getBodyDamage()
        if bd and bd.getCause then
            local c = bd:getCause()
            if c then cause = tostring(c) end
        end
    end
    ev.meta = { cause = cause }
    pushOrSkip(ev)
end

local function onChatMessage(msg)
    if not msg or not msg.getAuthor then return end
    local cfg = PZCrcon_Config and PZCrcon_Config.get() or {}
    if not cfg.enableChat then return end
    pushOrSkip({
        kind = "chat",
        ts = now(),
        name = msg:getAuthor(),
        meta = { text = msg:getText() },
    })
end

-- Helicopter is a separate global event in PZ — kicks off independent
-- of any player. Wire to `OnHelicopter` if present.
local function onHelicopter()
    pushOrSkip({ kind = "heli", ts = now() })
end

function PZCrcon_Events.install()
    if Events then
        if Events.OnPlayerConnect then Events.OnPlayerConnect.Add(onPlayerConnected) end
        if Events.OnPlayerDisconnect then Events.OnPlayerDisconnect.Add(onPlayerDisconnected) end
        if Events.OnPlayerDeath then Events.OnPlayerDeath.Add(onPlayerDeath) end
        if Events.OnHelicopter then Events.OnHelicopter.Add(onHelicopter) end
        if Events.OnServerStarted then
            Events.OnServerStarted.Add(function()
                print("[PZCrcon] Event hooks installed")
            end)
        end
    end
end

return PZCrcon_Events
