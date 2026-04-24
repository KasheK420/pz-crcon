--[[
    PZCrcon_Config
    ==============
    Reads operator-provided config from `Zomboid/Server/PZCrcon.cfg`, a
    simple `KEY=value` flat file (one entry per line, `#` = comment).

    Defaults below are used whenever a key is absent or the cfg file is
    missing. The `endpoint` and `secret` MUST be overridden in prod —
    the mod will refuse to POST if `secret` is still the default
    placeholder.

    Reloads are cheap: call `PZCrcon_Config.reload()` to re-read from
    disk (e.g. on `/reload` from an admin). The returned table is the
    same reference every time, so other modules can cache it.
]]

PZCrcon_Config = PZCrcon_Config or {}

local DEFAULTS = {
    endpoint          = "https://pz.majorluk.pl/api/webhook/mod",
    serverId          = "majorlukpz",
    secret            = "CHANGE_ME",
    tickMs            = 5000,   -- position flush interval
    heartbeatMs       = 30000,  -- heartbeat/status flush interval
    maxEventsPerPost  = 50,
    includeInvisible  = false,
    enableDebug       = false,
}

-- In-memory mutable copy; modules import this and re-read each tick so
-- hot-reloads propagate without restarts.
local state = {}
for k, v in pairs(DEFAULTS) do state[k] = v end

-- PZ's sandbox has `Core.getMyDocumentFolder()` returning the "Zomboid"
-- directory (cross-platform). We append Server/PZCrcon.cfg.
local function cfgPath()
    local base = getCacheDir and getCacheDir() or "."
    return base .. "/Server/PZCrcon.cfg"
end

local function parseLine(line, out)
    -- Strip surrounding whitespace + inline comments.
    local trimmed = line:gsub("^%s+", ""):gsub("%s+$", "")
    if trimmed == "" then return end
    if trimmed:sub(1, 1) == "#" then return end
    local eq = trimmed:find("=")
    if not eq or eq == 1 then return end
    local key = trimmed:sub(1, eq - 1):gsub("%s+$", "")
    local val = trimmed:sub(eq + 1):gsub("^%s+", ""):gsub("%s+$", "")
    if val:sub(1, 1) == '"' and val:sub(-1) == '"' then
        val = val:sub(2, -2)
    end
    -- Coerce numeric and boolean for known keys.
    if key == "tickMs" or key == "heartbeatMs" or key == "maxEventsPerPost" then
        val = tonumber(val) or DEFAULTS[key]
    elseif key == "includeInvisible" or key == "enableDebug" then
        val = (val == "true" or val == "1" or val == "yes")
    end
    out[key] = val
end

function PZCrcon_Config.reload()
    local path = cfgPath()
    local f = io.open(path, "r")
    if not f then
        print("[PZCrcon] Config file missing at " .. path .. " — using defaults")
        for k, v in pairs(DEFAULTS) do state[k] = v end
        return state
    end
    for k, v in pairs(DEFAULTS) do state[k] = v end
    for line in f:lines() do
        parseLine(line, state)
    end
    f:close()
    print("[PZCrcon] Loaded config from " .. path)
    return state
end

function PZCrcon_Config.get()
    return state
end

function PZCrcon_Config.isConfigured()
    return state.secret ~= nil
        and state.secret ~= ""
        and state.secret ~= DEFAULTS.secret
end

-- Boot-time load so downstream modules see the real values.
PZCrcon_Config.reload()

return PZCrcon_Config
