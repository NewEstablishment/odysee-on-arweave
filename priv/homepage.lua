local SNAPSHOT_SCHEMA = "odysee-homepage@1.0"
local SNAPSHOT_TYPE = "homepage-snapshot"
local DEFAULT_PAGE_SIZE = 12
local DEFAULT_POOL_SIZE = 36
local SEARCH_PAGE_SIZE = 36
local MAX_SEARCH_PAGES = 15
local STORE_READ_ATTEMPTS = 1

local function copy(value)
    if type(value) ~= "table" then return value end
    local result = {}
    for key, item in pairs(value) do result[key] = copy(item) end
    return result
end

local function array(value)
    if type(value) ~= "table" then
        if value == nil then return {} end
        return { value }
    end
    local indexed = {}
    for key, item in pairs(value) do
        local number = tonumber(key)
        if number ~= nil then table.insert(indexed, { key = number, value = item }) end
    end
    if #indexed == 0 then return value end
    table.sort(indexed, function(left, right) return left.key < right.key end)
    local result = {}
    for _, item in ipairs(indexed) do table.insert(result, item.value) end
    return result
end

local function positive(value, fallback)
    local number = tonumber(value)
    if number == nil or number < 1 then return fallback end
    return math.floor(number)
end

local function same_text(left, right)
    return left ~= nil and right ~= nil and tostring(left) == tostring(right)
end

local function outpoint(item)
    if type(item) ~= "table" or item.txid == nil or item.nout == nil then return nil end
    local nout = tonumber(item.nout)
    if nout == nil or nout < 0 or nout ~= math.floor(nout) then return nil end
    local nout_text = string.gsub(tostring(nout), "%.0$", "")
    return tostring(item.txid) .. ":" .. nout_text
end

local function channel(item)
    if type(item) ~= "table" then return nil end
    local signing = item.signing_channel or item["signing-channel"]
    if type(signing) ~= "table" then return nil end
    return signing
end

local function decode_json(body)
    if type(body) ~= "string" then return nil end
    local status, decoded = ao.resolve({ device = "json@1.0", body = body }, "deserialize")
    if status ~= "ok" then return nil end
    return decoded
end

local function encode_json(value)
    local function escape(text)
        return string.gsub(tostring(text), '[%z\1-\31\\"]', function(character)
            if character == '"' then return '\\"' end
            if character == '\\' then return '\\\\' end
            if character == '\b' then return '\\b' end
            if character == '\f' then return '\\f' end
            if character == '\n' then return '\\n' end
            if character == '\r' then return '\\r' end
            if character == '\t' then return '\\t' end
            return string.format('\\u%04x', string.byte(character))
        end)
    end

    local function encode(item, active)
        local item_type = type(item)
        if item == nil then return "null" end
        if item_type == "boolean" then return item and "true" or "false" end
        if item_type == "number" then
            if item ~= item or item == math.huge or item == -math.huge then return nil end
            return tostring(item)
        end
        if item_type == "string" then return '"' .. escape(item) .. '"' end
        if item_type ~= "table" or active[item] then return nil end

        active[item] = true
        local count = 0
        local highest = 0
        local indexed = true
        for key, _ in pairs(item) do
            count = count + 1
            if type(key) ~= "number" or key < 1 or key ~= math.floor(key) then
                indexed = false
            elseif key > highest then
                highest = key
            end
        end

        local parts = {}
        if indexed and count > 0 and highest == count then
            for index = 1, highest do
                local encoded = encode(item[index], active)
                if encoded == nil then active[item] = nil return nil end
                table.insert(parts, encoded)
            end
            active[item] = nil
            return "[" .. table.concat(parts, ",") .. "]"
        end

        local keys = {}
        for key, _ in pairs(item) do
            if type(key) ~= "string" then active[item] = nil return nil end
            table.insert(keys, key)
        end
        table.sort(keys)
        for _, key in ipairs(keys) do
            local encoded = encode(item[key], active)
            if encoded == nil then active[item] = nil return nil end
            table.insert(parts, '"' .. escape(key) .. '":' .. encoded)
        end
        active[item] = nil
        return "{" .. table.concat(parts, ",") .. "}"
    end

    return encode(value, {})
end

local function percent_encode(value)
    return string.gsub(tostring(value), "([^%w%-_%.~])", function(character)
        return string.format("%%%02X", string.byte(character))
    end)
end

local function store_read(path)
    for _ = 1, STORE_READ_ATTEMPTS do
        local status, result = ao.resolve({
            path = "/~cache@1.0/read",
            read = path,
            ["cache-control"] = { "no-store", "no-cache" }
        })
        if status == "ok" and type(result) == "table" then return result end
    end
    return nil
end

local function resolve_field(message, key)
    if type(message) ~= "table" then return nil end
    if message[key] ~= nil then return message[key] end
    local linked = message[key .. "+link"]
    if type(linked) == "string" then
        local loaded = store_read(linked)
        if loaded ~= nil then return loaded end
    end
    local status, value = ao.resolve(message, key)
    if status ~= "ok" then return nil end
    return value
end

local function display_claim(item)
    if type(item) ~= "table" then return nil end
    local reposted = item.reposted_claim or item["reposted-claim"]
    if type(reposted) == "table" then return reposted end
    return item
end

local function is_repost(item)
    if type(item) ~= "table" then return false end
    local value_type = item.value_type or item["value-type"]
    return value_type == "repost" or
        type(item.reposted_claim or item["reposted-claim"]) == "table"
end

local function has_usable_thumbnail(item)
    local displayed = display_claim(item)
    local value = resolve_field(displayed, "value")
    if type(value) ~= "table" then return false end
    local thumbnail = resolve_field(value, "thumbnail")
    local url = type(thumbnail) == "table" and (thumbnail.url or thumbnail["url"]) or thumbnail
    return type(url) == "string" and string.match(url, "%S") ~= nil
end

local function effective_release_time(item)
    local displayed = display_claim(item)
    local value = resolve_field(displayed, "value")
    local release_time = type(value) == "table" and
        (value.release_time or value["release-time"]) or nil
    if release_time == nil and type(displayed) == "table" then
        release_time = displayed.release_time or displayed["release-time"] or displayed.timestamp
    end
    return tonumber(release_time)
end

local function is_homepage_eligible(item, now)
    if is_repost(item) then return false end
    if not has_usable_thumbnail(item) then return false end
    local release_time = effective_release_time(item)
    return release_time == nil or release_time <= now
end

local function source_search(query)
    local normalized = copy(query)
    for _, key in ipairs({
        "channel_ids", "claim_ids", "not_channel_ids", "claim_type",
        "any_tags", "order_by", "any_languages"
    }) do
        if type(normalized[key]) == "table" then
            local values = {}
            for _, item in ipairs(array(normalized[key])) do table.insert(values, tostring(item)) end
            normalized[key] = table.concat(values, ",")
        end
    end
    local encoded = encode_json(normalized)
    if encoded == nil then return {} end
    local response = store_read("odysee/source-claims/" .. percent_encode(encoded))
    if response == nil then return {} end
    local decoded = decode_json(resolve_field(response, "body"))
    local items = resolve_field(decoded, "items")
    if type(items) ~= "table" then return {} end
    return array(items)
end

local function is_materializable_media(item)
    if type(item) ~= "table" then return false end
    local value_type = item.value_type or item["value-type"]
    if value_type ~= "stream" then return false end
    local value = item.value
    local source = type(value) == "table" and value.source or nil
    local sd_hash = type(source) == "table" and (source.sd_hash or source["sd-hash"]) or nil
    return type(sd_hash) == "string" and sd_hash ~= ""
end

local function is_channel(item)
    if type(item) ~= "table" then return false end
    local value_type = item.value_type or item["value-type"]
    if value_type ~= nil then return value_type == "channel" end
    local name = item["claim-name"] or item.name
    return type(name) == "string" and string.sub(name, 1, 1) == "@"
end

local function immutable_object_id(message, expected_evidence)
    if type(message) ~= "table" then return nil end
    local direct = message["immutable-id"] or message.immutable_id
    if type(direct) == "string" and direct ~= "" then return direct end
    local commitments = resolve_field(message, "commitments")
    if type(commitments) ~= "table" then return nil end
    for id, commitment in pairs(commitments) do
        if type(id) == "string" and string.len(id) == 43 and type(commitment) == "table" then
            local device = commitment["commitment-device"] or commitment.commitment_device
            local id_type = commitment["native-id-type"] or commitment.native_id_type
            local evidence = commitment.evidence
            if device == "lbry@1.0" and id_type == "outpoint" and evidence == expected_evidence then return id end
        end
    end
    return nil
end

local function exact_outpoint(item, expected_type)
    local locator = outpoint(item)
    if locator == nil then return nil end
    if expected_type == "media" and not is_materializable_media(item) then return nil end
    if expected_type == "channel" and not is_channel(item) then return nil end
    local response = store_read(
        "odysee/claim-output/" .. tostring(item.txid) .. "/" .. string.match(locator, ":(%d+)$")
    )
    if response == nil then return nil end
    if expected_type == "media" and (item.value_type or item["value-type"]) == "stream" then
        local sd_hash = response["sd-hash"] or response.sd_hash
        if type(sd_hash) ~= "string" or sd_hash == "" then return nil end
    end
    if expected_type == "channel" and not is_channel(response) then return nil end
    local evidence = expected_type == "channel" and "channel" or "claim"
    return immutable_object_id(response, evidence)
end

local function exact_id(id)
    if type(id) ~= "string" or id == "" then return nil end
    local response = store_read(id)
    if response == nil then return nil end
    return id
end

local function exact_homepage_id(id, now)
    if type(id) ~= "string" or id == "" then return nil end
    local response = store_read(id)
    if response == nil or not is_homepage_eligible(response, now) then return nil end
    return id
end

local function local_search(category, pool_size)
    local status, result = ao.resolve({
        path = "/~search@1.0/query",
        q = "",
        limit = math.min(100, pool_size),
        filter = { 'claim_type IN ["stream"]', "nsfw = 0" },
        sort = { "release_time:desc" },
        ["cache-control"] = { "no-store", "no-cache" }
    })
    if status ~= "ok" or type(result) ~= "table" then return nil end

    local ids = {}
    local seen = {}
    for _, raw_id in ipairs(array(result)) do
        local candidate_id = tostring(raw_id)
        local candidate = store_read(candidate_id)
        local id = candidate ~= nil and candidate_id or nil
        if id ~= nil and is_homepage_eligible(candidate, os.time()) and not seen[id] then
            seen[id] = true
            table.insert(ids, id)
        end
    end
    local page_size = positive(category.pageSize, DEFAULT_PAGE_SIZE)
    if #ids < page_size then return nil end
    local visible = {}
    for index = 1, math.min(page_size, #ids) do visible[index] = ids[index] end
    return { immutableIds = visible, immutablePoolIds = ids, immutableSigningChannelIds = {} }
end

local function category_query(category, now, page, page_size, relaxed)
    local order = category.order
    local order_by = { "trending_group", "trending_mixed" }
    if order == "new" then order_by = { "release_time" } end
    if order == "top" then order_by = { "effective_amount" } end

    local claim_types = { "stream" }
    local days = positive(category.daysOfContent, 30)
    if relaxed then days = math.max(days * 4, 365) end
    local query = {
        claim_type = claim_types,
        order_by = order_by,
        page = page,
        page_size = page_size,
        exclude_shorts = category.exclude_shorts == true
    }

    if not relaxed then
        if type(category.channelIds) == "table" and #category.channelIds > 0 then
            query.channel_ids = category.channelIds
        end
        if type(category.excludedChannelIds) == "table" and #category.excludedChannelIds > 0 then
            query.not_channel_ids = category.excludedChannelIds
        end
    end
    if type(category.tags) == "table" and #category.tags > 0 then query.any_tags = category.tags end
    if type(category.searchLanguages) == "table" and #category.searchLanguages > 0 then
        query.any_languages = category.searchLanguages
    end
    if category.duration ~= nil then query.duration = category.duration end
    query.timestamp = ">" .. tostring(now - days * 86400)
    query.release_time = "<" .. tostring(now)
    query.limit_claims_per_channel = 1
    return query
end

local function remove_id(ids, id)
    for index = #ids, 1, -1 do
        if ids[index] == id then table.remove(ids, index) end
    end
end

local function append_candidate(state, item, replace_channel)
    if not is_homepage_eligible(item, state.now) then return nil end
    local source_locator = outpoint(item)
    if source_locator == nil then return nil end
    if state.seen[source_locator] ~= nil then return state.seen[source_locator] end
    local signing = channel(item)
    local signing_source_locator = nil
    local signing_id = nil
    if signing ~= nil then
        signing_source_locator = outpoint(signing)
        if signing_source_locator == nil then return nil end
    end
    local existing_channel_media = signing_source_locator ~= nil and
        state.seen_channels[signing_source_locator] or nil
    if existing_channel_media ~= nil and replace_channel ~= true then return nil end

    local exact_media = exact_outpoint(item, "media")
    if exact_media == nil then return nil end
    if exact_homepage_id(exact_media, state.now) == nil then return nil end
    if signing ~= nil then
        signing_id = state.warmed_channels[signing_source_locator]
        if signing_id == nil then
            signing_id = exact_outpoint(signing, "channel")
            if signing_id == nil then return nil end
            if exact_id(signing_id) == nil then return nil end
            state.warmed_channels[signing_source_locator] = signing_id
        end
    end

    if existing_channel_media ~= nil and existing_channel_media ~= exact_media then
        remove_id(state.ids, existing_channel_media)
        local previous_source = state.source_by_media[existing_channel_media]
        if previous_source ~= nil then state.seen[previous_source] = nil end
        state.source_by_media[existing_channel_media] = nil
        state.channels[existing_channel_media] = nil
    end
    state.seen[source_locator] = exact_media
    state.source_by_media[exact_media] = source_locator
    table.insert(state.ids, exact_media)
    if signing_id ~= nil then
        state.channels[exact_media] = signing_id
        state.seen_channels[signing_source_locator] = exact_media
    end
    return exact_media
end

local function claim_id(item)
    if type(item) ~= "table" then return nil end
    return item.claim_id or item["claim-id"]
end

local function insert_pinned(state, pinned_claim_ids, pinned_items)
    if #pinned_claim_ids == 0 then return end
    local by_claim_id = {}
    for _, item in ipairs(pinned_items) do
        local id = claim_id(item)
        if type(id) == "string" then by_claim_id[id] = item end
    end

    local pinned_locators = {}
    local pinned_channels = {}
    for _, id in ipairs(pinned_claim_ids) do
        local item = by_claim_id[id]
        if item ~= nil then
            local signing_source_locator = outpoint(channel(item))
            if signing_source_locator == nil or not pinned_channels[signing_source_locator] then
                local immutable_id = append_candidate(state, item, true)
                if immutable_id ~= nil then
                    table.insert(pinned_locators, immutable_id)
                    if signing_source_locator ~= nil then
                        pinned_channels[signing_source_locator] = true
                    end
                end
            end
        end
    end

    for _, locator in ipairs(pinned_locators) do
        remove_id(state.ids, locator)
    end
    local position = math.min(3, #state.ids + 1)
    for index = #pinned_locators, 1, -1 do
        table.insert(state.ids, position, pinned_locators[index])
    end
end

local function collect_category(category, now, pool_size)
    if category.source == "search" then return local_search(category, pool_size) end
    local page_size = positive(category.pageSize, DEFAULT_PAGE_SIZE)
    local target = math.max(page_size, pool_size)
    local state = {
        now = now,
        ids = {},
        channels = {},
        seen = {},
        seen_channels = {},
        source_by_media = {},
        warmed_channels = {}
    }
    local pages = math.min(MAX_SEARCH_PAGES, math.max(1, math.ceil((target * 3) / SEARCH_PAGE_SIZE)))

    for page = 1, pages do
        local items = source_search(category_query(category, now, page, SEARCH_PAGE_SIZE, false))
        for _, item in ipairs(items) do
            append_candidate(state, item)
            if #state.ids >= target then break end
        end
        if #state.ids >= target then break end
    end

    if #state.ids < page_size then
        for page = 1, pages do
            local items = source_search(category_query(category, now, page, SEARCH_PAGE_SIZE, true))
            for _, item in ipairs(items) do
                append_candidate(state, item)
                if #state.ids >= target then break end
            end
            if #state.ids >= target then break end
        end
    end

    local pinned_claim_ids = array(category.pinnedClaimIds)
    if #pinned_claim_ids > 0 then
        local pinned_items = source_search({
            claim_ids = pinned_claim_ids,
            page = 1,
            page_size = #pinned_claim_ids,
            no_totals = true
        })
        insert_pinned(state, pinned_claim_ids, pinned_items)
    end

    if #state.ids < page_size then return nil end
    local visible = {}
    for index = 1, math.min(page_size, #state.ids) do visible[index] = state.ids[index] end
    return {
        immutableIds = visible,
        immutablePoolIds = state.ids,
        immutableSigningChannelIds = state.channels
    }
end

local function category_delta(category, selection)
    local result = {}
    local keys = {
        "name", "sortOrder", "icon", "label", "description", "image", "pageSize",
        "order", "claimType", "tags", "searchLanguages", "duration", "exclude_shorts", "source"
    }
    for _, key in ipairs(keys) do
        if category[key] ~= nil then result[key] = copy(category[key]) end
    end
    result.pageSize = positive(category.pageSize, DEFAULT_PAGE_SIZE)
    result.claimType = { "stream" }
    result.immutableIds = selection.immutableIds
    result.immutablePoolIds = selection.immutablePoolIds
    result.immutableSigningChannelIds = selection.immutableSigningChannelIds
    return result
end

local function ordered_categories(categories)
    local result = {}
    for id, category in pairs(categories or {}) do
        table.insert(result, { id = id, category = category })
    end
    table.sort(result, function(left, right)
        local left_order = tonumber(left.category.sortOrder) or 1000
        local right_order = tonumber(right.category.sortOrder) or 1000
        if left_order ~= right_order then return left_order < right_order end
        return tostring(left.id) < tostring(right.id)
    end)
    return result
end

local function claim_uri(url)
    if type(url) ~= "string" then return nil end
    local path = string.match(url, "^https?://[^/]+/(.+)$")
    if path == nil then return nil end
    path = string.gsub(path, "[?#].*$", "")
    path = string.gsub(path, ":", "#", 1)
    if path == "" then return nil end
    return "lbry://" .. path
end

local function source_resolve(uri)
    return store_read("odysee/claim/" .. percent_encode(uri))
end

local function materialize_featured(items, now)
    local result = {}
    local failures = {}
    for _, featured in ipairs(array(items)) do
        local uri = claim_uri(featured.url)
        local banner = uri ~= nil and source_resolve(uri) or nil
        local banner_id = exact_outpoint(banner, "channel")
        if banner_id ~= nil and exact_id(banner_id) == nil then banner_id = nil end
        local banner_locator = outpoint(banner)
        local channel_id = type(banner) == "table" and (banner["claim-id"] or banner.claim_id) or nil
        if banner_id ~= nil and channel_id ~= nil then
            local candidates = source_search({
                channel_ids = { tostring(channel_id) }, claim_type = { "stream" },
                order_by = { "release_time" }, page = 1, page_size = 12,
                release_time = "<" .. tostring(now), exclude_shorts = true
            })
            local media = {}
            local channels = {}
            local candidate_failures = { media = 0, channel = 0, mismatch = 0, first = nil }
            for _, item in ipairs(candidates) do
                local signing = channel(item)
                local signing_id = signing and exact_outpoint(signing, "channel") or nil
                if signing_id ~= nil and exact_id(signing_id) == nil then signing_id = nil end
                local signing_locator = outpoint(signing)
                local id = is_homepage_eligible(item, now) and exact_outpoint(item, "media") or nil
                if id ~= nil and exact_homepage_id(id, now) == nil then id = nil end
                if id ~= nil and signing_id ~= nil and same_text(signing_locator, banner_locator) then
                    table.insert(media, id)
                    channels[id] = signing_id
                elseif id == nil then
                    candidate_failures.media = candidate_failures.media + 1
                elseif signing_id == nil then
                    candidate_failures.channel = candidate_failures.channel + 1
                else
                    candidate_failures.mismatch = candidate_failures.mismatch + 1
                    if candidate_failures.first == nil then
                        candidate_failures.first =
                            tostring(signing_locator) .. " != " .. tostring(banner_locator)
                    end
                end
                if #media >= 3 then break end
            end
            if #media > 0 then
                local entry = copy(featured)
                entry.immutableId = banner_id
                entry.immutableIds = media
                entry.immutableSigningChannelIds = channels
                table.insert(result, entry)
            else
                table.insert(
                    failures,
                    tostring(uri) .. ": no exact media (candidates=" .. tostring(#candidates) ..
                        ", media=" .. tostring(candidate_failures.media) ..
                        ", channel=" .. tostring(candidate_failures.channel) ..
                        ", mismatch=" .. tostring(candidate_failures.mismatch) ..
                        ", first=" .. tostring(candidate_failures.first) .. ")"
                )
            end
        elseif uri == nil then
            table.insert(failures, tostring(featured.url) .. ": invalid URI")
        elseif banner == nil then
            table.insert(failures, tostring(uri) .. ": resolve failed")
        elseif banner_id == nil then
            table.insert(failures, tostring(uri) .. ": exact channel failed")
        else
            table.insert(failures, tostring(uri) .. ": claim ID missing")
        end
    end
    return result, failures
end

local function as_message(message)
    return { "as", "message@1.0", message }
end

local function persist_snapshot(language, homepage, now)
    local homepage_json = encode_json(homepage)
    if type(homepage_json) ~= "string" then return nil, "homepage encoding failed" end
    local hash_input = copy(homepage)
    local hash_status, content_hash = ao.resolve(
        as_message(hash_input),
        { path = "id", committers = "none" }
    )
    if hash_status ~= "ok" then return nil, "content hash failed" end
    local snapshot = {
        schema = SNAPSHOT_SCHEMA,
        type = SNAPSHOT_TYPE,
        language = language,
        ["epoch-hour"] = math.floor(now / 3600),
        ["created-at"] = now,
        ["content-hash"] = content_hash,
        ["category-count"] = #ordered_categories(homepage.categories),
        complete = true,
        ["homepage-json"] = homepage_json
    }
    local commit_status, committed = ao.resolve(
        as_message(snapshot),
        {
            path = "commit",
            committers = "all",
            bundle = true,
            ["commitment-device"] = "httpsig@1.0",
            type = "rsa-pss-sha512"
        }
    )
    if commit_status ~= "ok" or type(committed) ~= "table" then
        return nil, "snapshot commitment failed"
    end
    committed.priv = nil

    local id_status, published_id = ao.resolve(
        as_message(committed),
        { path = "id", committers = "all" }
    )
    if id_status ~= "ok" or type(published_id) ~= "string" or #published_id ~= 43 then
        return nil, "snapshot immutable ID failed"
    end

    local write_request = {
        path = "register",
        key = "odysee-homepage-" .. language,
        value = committed
    }
    local request_status, signed_request = ao.resolve(
        write_request,
        {
            "as",
            "message@1.0",
            {
                path = "commit",
                committers = "all",
                bundle = true,
                ["commitment-device"] = "httpsig@1.0",
                type = "rsa-pss-sha512"
            }
        }
    )
    if request_status ~= "ok" or type(signed_request) ~= "table" then
        return nil, {
            stage = "snapshot cache-write commitment",
            status = request_status,
            result = signed_request
        }
    end
    signed_request.priv = nil
    local write_status, write_result = ao.resolve(
        { device = "local-name@1.0" },
        signed_request
    )
    if write_status ~= "ok" then return nil, "snapshot registration failed: " .. tostring(write_result) end
    -- Returning the full snapshot here would make the enclosing Lua result a
    -- second discoverable snapshot with the Lua resolver's own commitment.
    -- Keep refresh output as an operational summary; the published ID above is
    -- the sole snapshot identity.
    return { id = published_id, language = language }, nil
end

function refresh(base, req, opts)
    local plan = req.homepages
    if type(plan) ~= "table" then
        local plan_id = req["plan-id"]
        if type(plan_id) ~= "string" then return "error", "homepage plan is required" end
        local loaded = store_read(plan_id)
        plan = resolve_field(loaded, "homepages")
    end
    if type(plan) ~= "table" then return "error", "homepage plan could not be loaded" end

    local now = os.time()
    local pool_size = positive(req["category-pool-size"], DEFAULT_POOL_SIZE)
    local selected_languages = {}
    for _, language in ipairs(array(req.languages)) do selected_languages[tostring(language)] = true end
    local filter_languages = next(selected_languages) ~= nil
    local snapshots = {}
    local failures = {}
    for language, source in pairs(plan) do
        if not filter_languages or selected_languages[language] then
            local homepage = { categories = {} }
            local language_failures = {}
            for _, entry in ipairs(ordered_categories(source.categories)) do
                local category_id = entry.id
                local category = entry.category
                local selection = collect_category(category, now, pool_size)
                if selection ~= nil then
                    homepage.categories[category_id] = category_delta(category, selection)
                elseif category.optional ~= true then
                    table.insert(language_failures, "category " .. tostring(category_id) .. " is incomplete")
                end
            end
            local featured_source = array(source.featured and source.featured.items)
            local featured, featured_failures = materialize_featured(featured_source, now)
            if #featured_source > 0 and #featured ~= #featured_source then
                for _, failure in ipairs(featured_failures) do
                    table.insert(language_failures, "featured " .. failure)
                end
            elseif #featured > 0 then
                homepage.featured = copy(source.featured)
                homepage.featured.items = featured
            end

            if #language_failures == 0 then
                local committed, persist_error = persist_snapshot(language, homepage, os.time())
                if committed ~= nil then
                    snapshots[language] = committed
                else
                    table.insert(language_failures, persist_error or "snapshot persistence failed")
                end
            end
            if #language_failures > 0 then
                failures[language] = language_failures
            end
        end
    end
    if next(snapshots) == nil then return "error", failures end
    return "ok", snapshots
end

_G["refresh"] = refresh
