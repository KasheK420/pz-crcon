--[[
    PZCrcon_Json
    ============
    Minimal JSON encoder for the webhook payload shape pz-crcon expects.

    Supports what the spec needs — numbers, strings, booleans, arrays,
    objects, `nil`/null — and nothing else. No fancy whitespace, no
    custom null sentinel.

    Not a drop-in for a full RFC-8259 encoder; for our needs (numbers,
    ASCII-ish names, region labels) this is sufficient and it keeps the
    mod dependency-free. Escapes `"` and `\` and control chars; leaves
    non-ASCII UTF-8 bytes intact (PZ names are mostly ASCII anyway).
]]

PZCrcon_Json = PZCrcon_Json or {}

local function escapeString(s)
    s = s:gsub("\\", "\\\\")
    s = s:gsub('"', '\\"')
    s = s:gsub("\n", "\\n")
    s = s:gsub("\r", "\\r")
    s = s:gsub("\t", "\\t")
    s = s:gsub("\b", "\\b")
    s = s:gsub("\f", "\\f")
    -- Purge remaining C0 control chars (0x00..0x1f).
    s = s:gsub("[\1-\31]", function(c)
        return string.format("\\u%04x", string.byte(c))
    end)
    return s
end

local function isArray(t)
    -- Heuristic: contiguous integer keys starting at 1.
    local n = 0
    for k in pairs(t) do
        if type(k) ~= "number" then return false end
        n = n + 1
    end
    if n == 0 then return true end
    for i = 1, n do
        if t[i] == nil then return false end
    end
    return true
end

local function encodeValue(v, out)
    local tv = type(v)
    if tv == "nil" then
        out[#out + 1] = "null"
    elseif tv == "boolean" then
        out[#out + 1] = v and "true" or "false"
    elseif tv == "number" then
        -- Reject NaN / Inf for strict JSON.
        if v ~= v or v == math.huge or v == -math.huge then
            out[#out + 1] = "null"
        else
            out[#out + 1] = tostring(v)
        end
    elseif tv == "string" then
        out[#out + 1] = '"' .. escapeString(v) .. '"'
    elseif tv == "table" then
        if isArray(v) then
            out[#out + 1] = "["
            for i, item in ipairs(v) do
                if i > 1 then out[#out + 1] = "," end
                encodeValue(item, out)
            end
            out[#out + 1] = "]"
        else
            out[#out + 1] = "{"
            local first = true
            for k, val in pairs(v) do
                if not first then out[#out + 1] = "," end
                first = false
                out[#out + 1] = '"' .. escapeString(tostring(k)) .. '":'
                encodeValue(val, out)
            end
            out[#out + 1] = "}"
        end
    else
        -- Unknown types (function, userdata) → null.
        out[#out + 1] = "null"
    end
end

function PZCrcon_Json.encode(value)
    local out = {}
    encodeValue(value, out)
    return table.concat(out)
end

return PZCrcon_Json
