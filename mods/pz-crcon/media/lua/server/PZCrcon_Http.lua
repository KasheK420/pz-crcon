--[[
    PZCrcon_Http
    ============
    Fire-and-forget POST via Java's `HttpURLConnection`, wrapped in a
    throwaway `Thread` so PZ's main server tick doesn't block on the
    network round-trip.

    Failures are swallowed with a debug-level print. Callers should
    never await a response; the panel's webhook is fire-and-forget by
    design (positions are replaceable — dropping a batch is fine, the
    next tick sends fresh data).
]]

PZCrcon_Http = PZCrcon_Http or {}

local _imported = false
local _URL, _Thread, _Runnable, _String

local function tryImport()
    if _imported then return _URL ~= nil end
    _imported = true
    local ln = rawget(_G, "luanet")
    if not ln and type(require) == "function" then
        local ok, m = pcall(require, "luanet")
        if ok then ln = m end
    end
    if not ln or type(ln.import_type) ~= "function" then
        return false
    end
    local ok1, URL = pcall(ln.import_type, "java.net.URL")
    local ok2, Thread = pcall(ln.import_type, "java.lang.Thread")
    local ok3, Runnable = pcall(ln.import_type, "java.lang.Runnable")
    local ok4, JString = pcall(ln.import_type, "java.lang.String")
    if not (ok1 and ok2 and ok3 and ok4) then
        return false
    end
    _URL = URL
    _Thread = Thread
    _Runnable = Runnable
    _String = JString
    return true
end

local function bytesOf(s)
    return _String(s):getBytes("UTF-8")
end

local function doPost(url, body, headers)
    local conn = _URL(url):openConnection()
    conn:setRequestMethod("POST")
    conn:setDoOutput(true)
    conn:setConnectTimeout(3000)
    conn:setReadTimeout(5000)
    conn:setRequestProperty("Content-Type", "application/json; charset=UTF-8")
    if headers then
        for k, v in pairs(headers) do
            conn:setRequestProperty(k, v)
        end
    end
    local os = conn:getOutputStream()
    os:write(bytesOf(body))
    os:flush()
    os:close()
    local code = conn:getResponseCode()
    conn:disconnect()
    return code
end

function PZCrcon_Http.postAsync(url, body, headers, onDone)
    if not tryImport() then
        if onDone then onDone(false, 0, "luanet-unavailable") end
        return
    end
    -- `luanet.create_delegate(Runnable, "run", fn)` is the canonical way
    -- to hand a Lua function to Java as an interface implementation. We
    -- fallback to synchronous exec if the delegate API isn't available.
    local ln = rawget(_G, "luanet")
    local okDelegate, delegate = false, nil
    if ln and type(ln.create_delegate) == "function" then
        okDelegate, delegate = pcall(ln.create_delegate, _Runnable, "run", function()
            local ok, codeOrErr = pcall(doPost, url, body, headers)
            if onDone then
                pcall(onDone, ok and codeOrErr >= 200 and codeOrErr < 300, codeOrErr, nil)
            end
        end)
    end
    if okDelegate and delegate then
        local thread = _Thread(delegate)
        thread:setDaemon(true)
        thread:start()
    else
        local ok, codeOrErr = pcall(doPost, url, body, headers)
        if onDone then
            pcall(onDone, ok and codeOrErr >= 200 and codeOrErr < 300, ok and codeOrErr or 0, ok and nil or codeOrErr)
        end
    end
end

return PZCrcon_Http
