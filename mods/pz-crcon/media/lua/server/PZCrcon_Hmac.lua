--[[
    PZCrcon_Hmac
    ============
    HMAC-SHA256 via Java interop (PZ 41.78+ ships the JRE's
    `javax.crypto` on the server).

    We deliberately use Java's Mac rather than a pure-Lua SHA2 port:
    - Code stays tiny (~30 lines) and hot path is native.
    - No need to audit a hand-rolled big-endian unsigned-int reducer.
    - Java HMAC is constant-time on the critical path.

    Luanet imports resolve lazily on first call so this module loading
    doesn't blow up on a platform where `luanet` isn't available
    (falls back to a warning + always-invalid signature, so the mod
    fails loud rather than silently sending unsigned payloads).
]]

PZCrcon_Hmac = PZCrcon_Hmac or {}

local _imported = false
local _Mac
local _SecretKeySpec
local _String

local function tryImport()
    if _imported then return _Mac ~= nil end
    _imported = true
    -- PZ's `luanet` may be a global or require-module depending on
    -- build; try both shapes.
    local ln = rawget(_G, "luanet")
    if not ln and type(require) == "function" then
        local ok, m = pcall(require, "luanet")
        if ok then ln = m end
    end
    if not ln or type(ln.import_type) ~= "function" then
        print("[PZCrcon] Java interop unavailable — HMAC cannot be computed")
        return false
    end
    local ok1, Mac = pcall(ln.import_type, "javax.crypto.Mac")
    local ok2, SecretKeySpec = pcall(ln.import_type, "javax.crypto.spec.SecretKeySpec")
    local ok3, JString = pcall(ln.import_type, "java.lang.String")
    if not (ok1 and ok2 and ok3) then
        print("[PZCrcon] Java crypto classes failed to import")
        return false
    end
    _Mac = Mac
    _SecretKeySpec = SecretKeySpec
    _String = JString
    return true
end

local function bytesOf(s)
    -- java.lang.String(String).getBytes("UTF-8") → byte[]
    return _String(s):getBytes("UTF-8")
end

local HEX = "0123456789abcdef"

local function toHex(bytes)
    local parts = {}
    local n = bytes.length or #bytes
    for i = 0, n - 1 do
        local b = bytes[i]
        if b < 0 then b = b + 256 end
        local hi = math.floor(b / 16)
        local lo = b - hi * 16
        parts[#parts + 1] = HEX:sub(hi + 1, hi + 1) .. HEX:sub(lo + 1, lo + 1)
    end
    return table.concat(parts)
end

function PZCrcon_Hmac.sha256(secret, body)
    if not tryImport() then return nil end
    local mac = _Mac:getInstance("HmacSHA256")
    mac:init(_SecretKeySpec(bytesOf(secret), "HmacSHA256"))
    local sig = mac:doFinal(bytesOf(body))
    return toHex(sig)
end

return PZCrcon_Hmac
