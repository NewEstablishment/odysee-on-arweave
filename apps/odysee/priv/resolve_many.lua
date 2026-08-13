local MAX_REQUESTS = 512

function resolve_many(base, req, opts)
    local requests = req.requests
    if type(requests) ~= "table" then
        return "error", "requests must be an ordered list"
    end

    local results = {}
    local count = 0
    for index, subrequest in ipairs(requests) do
        count = count + 1
        if count > MAX_REQUESTS then
            return "error", "request limit exceeded"
        end

        local status, result = ao.resolve(subrequest)
        results[index] = {
            status = status,
            result = result
        }
    end

    return "ok", results
end

_G["resolve-many"] = resolve_many
