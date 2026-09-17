%%% @doc Page analytics for HyperBEAM.
%%%
%%% `analytics@1.0' lets a wallet register a web app, invite additional wallets,
%%% embed a public tracking key, collect page-load visits, active duration, and
%%% basic IP/location demographics, and inspect the results through an external
%%% wallet-authenticated dashboard.
%%%
%%% By default the public tracker creates only an in-memory visit ID. Sites may
%%% explicitly enable a random first-party persistent visitor ID when they need
%%% cross-day active-user and retention analytics. The device hashes that ID
%%% with a private per-site salt before storing it and never exposes visitor
%%% identifiers in reports.
-module(dev_analytics).
-implements(<<"analytics@1.0">>).
-specification("../SPEC.md").
-export([
    info/1,
    nonce/3,
    register/3,
    delete/3,
    sites/3,
    report/3,
    script/3,
    session/3,
    event/3,
    engagement/3,
    count/3,
    counts/3,
    subjects/3,
    baseline/3
]).
-include_lib("hb/include/hb.hrl").

-define(NO_CACHE, [<<"no-cache">>, <<"no-store">>]).
-define(MAX_DAYS, 365).
-define(DEFAULT_DAYS, 14).
-define(MAX_DURATION_MS, 86_400_000).
%% "Current visitors" liveness backstop. An open tab heartbeats every ~15s (and
%% ~once/min when backgrounded, due to browser timer throttling), so this only
%% needs to comfortably exceed the throttled interval to keep open-but-idle tabs
%% counted. Graceful closes drop instantly via the `end' ping / `ended' flag
%% (see active_visit/3); this window just bounds how long an *ungraceful* exit
%% (crash, killed tab, dropped network) lingers before ageing out.
-define(DEFAULT_ACTIVE_WINDOW_MS, 120_000).
-define(SESSION_WINDOW_MS, 1_800_000).
-define(ENGAGED_SESSION_MS, 10_000).
-define(DEFAULT_NONCE_TTL_MS, 300_000).
-define(DEFAULT_ENGAGEMENT_THRESHOLD_MS, 30_000).
-define(DEFAULT_ENGAGEMENT_DEDUPE_WINDOW_MS, 86_400_000).
-define(DEFAULT_ENGAGEMENT_CLOCK_SKEW_MS, 15_000).
-define(SITE_KEY_BYTES, 32).
-define(NONCE_BYTES, 24).
-define(GEOIP_LOADER, analytics_geoip).
-define(GEOIP_STATE_KEY, {?MODULE, geoip_state}).
%% Per-page mirrors of the site-wide demographic/acquisition/technology
%% dimension buckets (see `update_daily/4', `pages_from_days/1').
-define(PAGE_DIMENSION_BUCKET_KEYS, [
    <<"by-ip">>, <<"by-location">>, <<"by-referrer">>, <<"by-utm-source">>,
    <<"by-utm-medium">>, <<"by-utm-campaign">>, <<"by-device">>, <<"by-browser">>,
    <<"by-os">>, <<"by-language">>
]).

%% @doc Return the public device API.
info(_Opts) ->
    #{
        exports => [
            <<"nonce">>,
            <<"register">>,
            <<"delete">>,
            <<"sites">>,
            <<"report">>,
            <<"script">>,
            <<"session">>,
            <<"event">>,
            <<"engagement">>,
            <<"count">>,
            <<"counts">>,
            <<"subjects">>,
            <<"baseline">>
        ]
    }.

%% @doc Create a short-lived dashboard authentication nonce.
nonce(_Base, Req, Opts) ->
    Owner = trim_bin(hb_maps:get(<<"owner">>, Req, <<"anonymous">>, Opts)),
    Nonce = random_token(?NONCE_BYTES),
    Message = auth_message(Owner, Nonce),
    Now = now_ms(),
    Record =
        #{
            <<"owner">> => Owner,
            <<"nonce">> => Nonce,
            <<"message">> => Message,
            <<"issued-at">> => Now,
            <<"used">> => false
        },
    ok = write_json(nonce_path(Owner, Nonce, Opts), Record, Opts),
    json_ok(
        #{
            <<"owner">> => Owner,
            <<"nonce">> => Nonce,
            <<"message">> => Message,
            <<"expires-in-ms">> => nonce_ttl_ms(Opts)
        }
    ).

%% @doc Register a wallet-owned site and return its public tracking key.
register(_Base, Req, Opts) ->
    case owner_for_request(Req, Opts) of
        {ok, Owner} ->
            Key = site_key(Req, Opts),
            Now = now_ms(),
            Existing = read_site(Key, Opts),
            case site_owner_allowed(Existing, Owner, Opts) of
                true ->
                    Site =
                        site_record(
                            Existing,
                            Key,
                            Owner,
                            Req,
                            Now,
                            Opts
                        ),
                    ok = write_json(site_path(Key, Opts), Site, Opts),
                    ok = index_site_access(Site, Opts),
                    json_ok(registration_response(Site, Req, Opts));
                false ->
                    json_error(403, <<"Tracking key belongs to another wallet.">>)
            end;
        {error, Status, Reason} ->
            json_error(Status, Reason)
    end.

%% @doc Soft-delete a wallet-owned site: mark it disabled so it disappears from
%% the owner's site list and stops accepting new tracking. Existing data is
%% retained (the store has no per-key delete), and re-registering the same
%% domain re-enables it.
delete(_Base, Req, Opts) ->
    case owner_site_for_request(Req, Opts) of
        {ok, Owner, Site} ->
            case hb_maps:get(<<"owner">>, Site, Owner, Opts) of
                Owner ->
                    Key = hb_maps:get(<<"key">>, Site, undefined, Opts),
                    Disabled = Site#{ <<"enabled">> => false, <<"updated-at">> => now_ms() },
                    ok = write_json(site_path(Key, Opts), Disabled, Opts),
                    json_ok(#{ <<"ok">> => true, <<"key">> => Key });
                _ ->
                    json_error(403, <<"Only the site owner can delete it.">>)
            end;
        {error, Status, Reason} ->
            json_error(Status, Reason)
    end.

%% @doc Return the authenticated owner's registered sites.
sites(_Base, Req, Opts) ->
    case owner_for_request(Req, Opts) of
        {ok, Owner} ->
            %% Ensure the owner's index is a listable group before listing.
            %% This both supports newly-written index entries and self-heals
            %% any entries written before the group marker was created (e.g. by
            %% an earlier build), which the underlying leaf writes already
            %% persisted. See ensure_group/2.
            ok = ensure_group(owner_path(Owner, Opts), Opts),
            SiteKeys =
                case hb_store:list(owner_path(Owner, Opts), Opts) of
                    {ok, Keys} -> lists:sort(Keys);
                    _ -> []
                end,
            StoredSiteRecords =
                lists:filtermap(
                    fun(Key) ->
                        case read_site(Key, Opts) of
                            undefined -> false;
                            Site ->
                                case site_wallet_allowed(Site, Owner, Opts) andalso site_enabled(Site, Opts) of
                                    true -> {true, public_site(Site, Opts)};
                                    false -> false
                                end
                        end
                    end,
                    SiteKeys
                ),
            ConfiguredSiteRecords = configured_sites_for_owner(Owner, Opts),
            SitesByKey =
                lists:foldl(
                    fun(Site, Acc) ->
                        Acc#{ hb_maps:get(<<"key">>, Site, <<>>, Opts) => Site }
                    end,
                    #{},
                    ConfiguredSiteRecords ++ StoredSiteRecords
                ),
            SiteRecords = [maps:get(Key, SitesByKey) || Key <- lists:sort(maps:keys(SitesByKey))],
            json_ok(
                #{
                    <<"owner">> => Owner,
                    <<"sites">> => SiteRecords
                }
            );
        {error, Status, Reason} ->
            json_error(Status, Reason)
    end.

%% @doc Return aggregate analytics for a wallet-owned tracking key.
report(_Base, Req, Opts) ->
    case owner_site_for_request(Req, Opts) of
        {ok, Owner, Site} ->
            Days = days(Req, Opts),
            Key = hb_maps:get(<<"key">>, Site, undefined, Opts),
            %% Optional route filter, used only to scope the realtime
            %% `active'/`active-pages' summary fields (see summary_from_days/4).
            %% Everything else in this response stays full/unfiltered; the
            %% dashboard filters the rest client-side from `pages'/`days'.
            Route = normalize_route(hb_maps:get(<<"page">>, Req, undefined, Opts)),
            Dates = last_dates(Days),
            Daily =
                [
                    normalize_daily(
                        Date,
                        read_json(daily_path(Key, Date, Opts), daily_default(Date), Opts)
                    )
                 || Date <- Dates
                ],
            Pages = pages_from_days(Daily),
            Demographics = demographics_from_days(Daily),
            Summary = summary_from_days(Key, Daily, Route, Opts),
            Audience = audience_from_days(Daily),
            Sessions = maps:get(<<"sessions">>, Summary, 0),
            json_ok(
                #{
                    <<"owner">> => Owner,
                    <<"site">> => public_site(Site, Opts),
                    <<"days">> => [public_daily(Day) || Day <- Daily],
                    <<"audience">> => Audience,
                    <<"retention">> => retention_from_days(Daily),
                    <<"demographics">> => Demographics,
                    <<"acquisition">> => acquisition_from_days(Daily),
                    <<"technology">> => technology_from_days(Daily),
                    <<"navigation">> => navigation_from_days(Daily),
                    <<"events">> => events_from_days(Daily, Sessions),
                    <<"actions">> => actions_from_days(Daily, Sessions),
                    <<"pages">> => Pages,
                    <<"summary">> => Summary
                }
            );
        {error, Status, Reason} ->
            json_error(Status, Reason)
    end.

%% @doc Return the browser tracker script with a public key embedded.
script(_Base, Req, Opts) ->
    case required(<<"key">>, Req, Opts) of
        {ok, Key} ->
            case read_site(Key, Opts) of
                undefined ->
                    js_error(404, <<"Unknown tracking key.">>);
                Site ->
                    case static(<<"session.js">>, Opts) of
                        {ok, Msg = #{ <<"body">> := Body }} ->
                            Body1 =
                                binary:replace(
                                    Body,
                                    <<"{{TRACKING_KEY}}">>,
                                    js_string_escape(Key),
                                    [global]
                                ),
                            Body2 =
                                binary:replace(
                                    Body1,
                                    <<"{{VISITOR_ID_MODE}}">>,
                                    js_string_escape(site_visitor_id_mode(Site, Opts)),
                                    [global]
                                ),
                            with_common_headers(
                                {ok,
                                    Msg#{
                                        <<"body">> => Body2,
                                        <<"content-type">> => <<"text/javascript">>
                                    }}
                            );
                        Other ->
                            Other
                    end
            end;
        {error, Reason} ->
            js_error(400, Reason)
    end.

%% @doc Accept an anonymous visit/duration ping.
session(_Base, Req, Opts) ->
    case required(<<"key">>, Req, Opts) of
        {ok, Key} ->
            case read_active_site(Key, Opts) of
                undefined ->
                    json_error(404, <<"Unknown tracking key.">>);
                Site ->
                    case origin_allowed(Site, Req, Opts) of
                        true ->
                            VisitID = visit_id(Req, Opts),
                            Page = page_path(Req, Opts),
                            Event = event_type(Req, Opts),
                            Duration = duration_ms(Req, Opts),
                            Demographics = demographics(Req, Opts),
                            Dimensions = dimensions(Site, Req, Opts),
                            Date = today(),
                            PersistentVisitor =
                                persistent_visitor(Key, Site, Date, Req, Dimensions, Opts),
                            VisitorHash = visitor_hash(Key, Date, Demographics, Req, PersistentVisitor, Opts),
                            {ok, Visit} =
                                update_visit_and_daily(
                                    Key,
                                    Date,
                                    VisitID,
                                    Page,
                                    Event,
                                    Duration,
                                    Demographics,
                                    Dimensions,
                                    VisitorHash,
                                    PersistentVisitor,
                                    Opts
                                ),
                            json_ok(
                                #{
                                    <<"ok">> => true,
                                    <<"visit">> => hb_maps:get(<<"visit">>, Visit, undefined, Opts),
                                    <<"duration-ms">> =>
                                        hb_maps:get(<<"duration-ms">>, Visit, 0, Opts)
                                }
                            );
                        false ->
                            json_error(403, <<"Origin is not allowed for this tracking key.">>)
                    end
            end;
        {error, Reason} ->
            json_error(400, Reason)
    end.

%% @doc Accept a custom event (e.g. Signup, Purchase) for conversion tracking.
%% Like `session', this is intentionally unsigned because it is fired by visitors'
%% browsers; the tracking key is public and `origin' restrictions apply.
event(_Base, Req, Opts) ->
    case required(<<"key">>, Req, Opts) of
        {ok, Key} ->
            case read_active_site(Key, Opts) of
                undefined ->
                    json_error(404, <<"Unknown tracking key.">>);
                Site ->
                    case origin_allowed(Site, Req, Opts) of
                        true ->
                            case required(<<"name">>, Req, Opts) of
                                {ok, RawName} ->
                                    Name = event_name(RawName),
                                    Value = duration_ms(Req, Opts),
                                    Kind = event_kind(Req, Opts),
                                    Date = today(),
                                    Page = event_page(Req, Opts),
                                    SubjectID = event_subject_id(Req, Opts),
                                    ok = record_subject_event(Key, SubjectID, Name, Opts),
                                    ok = record_event(Key, Date, Name, Kind, Value, Page, Opts),
                                    Response0 = #{ <<"ok">> => true, <<"event">> => Name, <<"type">> => Kind },
                                    Response =
                                        case SubjectID of
                                            undefined -> Response0;
                                            _ -> Response0#{ <<"subject-id">> => SubjectID }
                                        end,
                                    json_ok(Response);
                                {error, Reason} ->
                                    json_error(400, Reason)
                            end;
                        false ->
                            json_error(403, <<"Origin is not allowed for this tracking key.">>)
                    end
            end;
        {error, Reason} ->
            json_error(400, Reason)
    end.

%% @doc Accept a generic, resumable engagement lifecycle for an arbitrary
%% subject. Product integrations decide what a subject represents and what a
%% qualified engagement means in their own UI; this device only validates
%% monotonic evidence against the site's configured threshold.
engagement(_Base, Req, Opts) ->
    case required(<<"key">>, Req, Opts) of
        {ok, Key} ->
            case read_active_site(Key, Opts) of
                undefined ->
                    json_error(404, <<"Unknown tracking key.">>);
                Site ->
                    case origin_allowed(Site, Req, Opts) of
                        false ->
                            json_error(403, <<"Origin is not allowed for this tracking key.">>);
                        true ->
                            case engagement_request(Req, Opts) of
                                {error, Reason} ->
                                    json_error(400, Reason);
                                {ok, Input0} ->
                                    Input = Input0#{
                                        <<"viewer-id">> => engagement_viewer_id(Key, Site, Req, Opts),
                                        <<"view-bucket">> => engagement_view_bucket(Site, Opts)
                                    },
                                    engagement_result(
                                        with_subject_lock(
                                            Key,
                                            maps:get(<<"subject-id">>, Input),
                                            fun() -> update_engagement(Key, Site, Input, Opts) end
                                        )
                                    )
                            end
                    end
            end;
        {error, Reason} ->
            json_error(400, Reason)
    end.

%% @doc Return the public aggregate for one arbitrary subject. Detailed site
%% reports remain wallet-authenticated; this endpoint exposes counters only.
count(_Base, Req, Opts) ->
    case required(<<"key">>, Req, Opts) of
        {ok, Key} ->
            case read_active_site(Key, Opts) of
                undefined ->
                    json_error(404, <<"Unknown tracking key.">>);
                Site ->
                    case origin_allowed(Site, Req, Opts) of
                        false ->
                            json_error(403, <<"Origin is not allowed for this tracking key.">>);
                        true ->
                            case required(<<"subject-id">>, Req, Opts) of
                                {ok, RawSubjectID} ->
                                    SubjectID = limit_binary(trim_bin(RawSubjectID), 512),
                                    Aggregate =
                                        read_json(
                                            subject_path(Key, SubjectID, Opts),
                                            subject_default(SubjectID),
                                            Opts
                                        ),
                                    json_ok(public_count(Aggregate));
                                {error, Reason} ->
                                    json_error(400, Reason)
                            end
                    end
            end;
        {error, Reason} ->
            json_error(400, Reason)
    end.

%% @doc Return ordered public aggregates for up to 100 subjects in one request.
counts(_Base, Req, Opts) ->
    case required(<<"key">>, Req, Opts) of
        {ok, Key} ->
            case read_active_site(Key, Opts) of
                undefined ->
                    json_error(404, <<"Unknown tracking key.">>);
                Site ->
                    case origin_allowed(Site, Req, Opts) of
                        false ->
                            json_error(403, <<"Origin is not allowed for this tracking key.">>);
                        true ->
                            SubjectIDs0 =
                                parse_binary_list(
                                    hb_ao:get_first(
                                        [
                                            {Req, <<"subject-ids">>},
                                            {Req, <<"subjects">>}
                                        ],
                                        [],
                                        Opts
                                    )
                                ),
                            SubjectIDs =
                                lists:sublist(
                                    [
                                        limit_binary(SubjectID, 512)
                                     || SubjectID <- SubjectIDs0,
                                        SubjectID =/= <<>>
                                    ],
                                    100
                                ),
                            case SubjectIDs of
                                [] ->
                                    json_error(400, <<"Missing required field: subject-ids">>);
                                _ ->
                                    Counts =
                                        [
                                            public_count(
                                                read_json(
                                                    subject_path(Key, SubjectID, Opts),
                                                    subject_default(SubjectID),
                                                    Opts
                                                )
                                            )
                                         || SubjectID <- SubjectIDs
                                        ],
                                    json_ok(#{ <<"counts">> => Counts })
                            end
                    end
            end;
        {error, Reason} ->
            json_error(400, Reason)
    end.

%% @doc Return an authenticated, paginated list of subject aggregates for a
%% tracking key. Subject IDs remain product-defined; the device only exposes
%% generic counters and migration metadata already available through `count'.
subjects(_Base, Req, Opts) ->
    case owner_site_for_request(Req, Opts) of
        {ok, Owner, Site} ->
            Key = hb_maps:get(<<"key">>, Site, <<>>, Opts),
            Page = bounded_positive_int(hb_maps:get(<<"page">>, Req, 1, Opts), 1, 1_000_000),
            PageSize = bounded_positive_int(hb_maps:get(<<"page-size">>, Req, 50, Opts), 50, 100),
            ok = ensure_group(subjects_path(Key, Opts), Opts),
            SubjectKeys =
                case hb_store:list(subjects_path(Key, Opts), Opts) of
                    {ok, Keys} -> Keys;
                    _ -> []
                end,
            Aggregates0 =
                [
                    public_count(Aggregate)
                 || SubjectKey <- SubjectKeys,
                    Aggregate <- [read_json(subject_child_path(Key, SubjectKey, Opts), undefined, Opts)],
                    is_map(Aggregate)
                ],
            Aggregates =
                lists:sort(
                    fun(A, B) ->
                        maps:get(<<"updated-at">>, A, 0) >= maps:get(<<"updated-at">>, B, 0)
                    end,
                    Aggregates0
                ),
            Total = length(Aggregates),
            Offset = (Page - 1) * PageSize,
            Items = lists:sublist(drop_n(Offset, Aggregates), PageSize),
            json_ok(
                #{
                    <<"owner">> => Owner,
                    <<"site">> => public_site(Site, Opts),
                    <<"subjects">> => Items,
                    <<"page">> => Page,
                    <<"page-size">> => PageSize,
                    <<"total">> => Total
                }
            );
        {error, Status, Reason} ->
            json_error(Status, Reason)
    end.

%% @doc Import a one-time aggregate baseline for a subject. This is an
%% authenticated generic migration primitive: the device stores source/version
%% metadata but does not interpret it. A baseline cannot be replaced with a
%% different value or version after it is accepted.
baseline(_Base, Req, Opts) ->
    case baseline_site_for_request(Req, Opts) of
        {ok, _Owner, Site} ->
            case baseline_request(Req, Opts) of
                {error, Reason} ->
                    json_error(400, Reason);
                {ok, Input} ->
                    Key = hb_maps:get(<<"key">>, Site, <<>>, Opts),
                    SubjectID = maps:get(<<"subject-id">>, Input),
                    baseline_result(
                        with_subject_lock(
                            Key,
                            SubjectID,
                            fun() -> set_baseline(Key, Input, Opts) end
                        )
                    )
            end;
        {error, Status, Reason} ->
            json_error(Status, Reason)
    end.

engagement_result({ok, Interaction, Aggregate, Idempotent}) ->
    json_ok(
        #{
            <<"ok">> => true,
            <<"idempotent">> => Idempotent,
            <<"interaction">> => public_interaction(Interaction),
            <<"count">> => public_count(Aggregate)
        }
    );
engagement_result({error, Status, Reason}) ->
    json_error(Status, Reason);
engagement_result({aborted, _Reason}) ->
    json_error(503, <<"Engagement update was aborted.">>).

baseline_result({ok, Aggregate, Idempotent}) ->
    json_ok(
        #{
            <<"ok">> => true,
            <<"idempotent">> => Idempotent,
            <<"count">> => public_count(Aggregate)
        }
    );
baseline_result({error, Status, Reason}) ->
    json_error(Status, Reason);
baseline_result({aborted, _Reason}) ->
    json_error(503, <<"Baseline update was aborted.">>).

with_subject_lock(Key, SubjectID, Fun) ->
    Resource = {?MODULE, path_component(Key), path_component(SubjectID)},
    global:trans({Resource, self()}, Fun).

engagement_request(Req, Opts) ->
    case {
        required(<<"subject-id">>, Req, Opts),
        required(<<"interaction-id">>, Req, Opts),
        required(<<"event">>, Req, Opts),
        required(<<"sequence">>, Req, Opts),
        required(<<"active-ms">>, Req, Opts)
    } of
        {{ok, RawSubjectID}, {ok, RawInteractionID}, {ok, RawEvent}, {ok, RawSequence}, {ok, RawActiveMS}} ->
            SubjectID = limit_binary(trim_bin(RawSubjectID), 512),
            InteractionID = limit_binary(trim_bin(RawInteractionID), 128),
            Event = engagement_event(RawEvent),
            Sequence = int_value(RawSequence, -1),
            ActiveMS = int_value(RawActiveMS, -1),
            PositionMS =
                int_value(hb_maps:get(<<"position-ms">>, Req, 0, Opts), -1),
            case {
                SubjectID =/= <<>>,
                InteractionID =/= <<>>,
                Event =/= invalid,
                Sequence >= 0,
                ActiveMS >= 0 andalso ActiveMS =< ?MAX_DURATION_MS,
                PositionMS >= 0 andalso PositionMS =< ?MAX_DURATION_MS
            } of
                {true, true, true, true, true, true} ->
                    {ok,
                        #{
                            <<"subject-id">> => SubjectID,
                            <<"interaction-id">> => InteractionID,
                            <<"event">> => Event,
                            <<"sequence">> => Sequence,
                            <<"active-ms">> => ActiveMS,
                            <<"position-ms">> => PositionMS
                        }};
                _ ->
                    {error, <<"Invalid engagement fields.">>}
            end;
        _ ->
            {error, <<"Missing required engagement field.">>}
    end.

baseline_request(Req, Opts) ->
    case {
        required(<<"subject-id">>, Req, Opts),
        required(<<"value">>, Req, Opts),
        required(<<"version">>, Req, Opts),
        required(<<"cutover-at">>, Req, Opts)
    } of
        {{ok, RawSubjectID}, {ok, RawValue}, {ok, RawVersion}, {ok, RawCutoverAt}} ->
            SubjectID = limit_binary(trim_bin(RawSubjectID), 512),
            Value = int_value(RawValue, -1),
            Version = limit_binary(trim_bin(RawVersion), 128),
            CutoverAt = int_value(RawCutoverAt, -1),
            Source = limit_binary(trim_bin(hb_maps:get(<<"source">>, Req, <<>>, Opts)), 256),
            case SubjectID =/= <<>> andalso Value >= 0 andalso Version =/= <<>> andalso CutoverAt >= 0 of
                true ->
                    {ok,
                        #{
                            <<"subject-id">> => SubjectID,
                            <<"value">> => Value,
                            <<"version">> => Version,
                            <<"cutover-at">> => CutoverAt,
                            <<"source">> => Source
                        }};
                false ->
                    {error, <<"Invalid baseline fields.">>}
            end;
        _ ->
            {error, <<"Missing required baseline field.">>}
    end.

engagement_event(Raw) ->
    case trim_bin(Raw) of
        <<"start">> -> <<"start">>;
        <<"heartbeat">> -> <<"heartbeat">>;
        <<"pause">> -> <<"pause">>;
        <<"complete">> -> <<"complete">>;
        <<"end">> -> <<"end">>;
        _ -> invalid
    end.

update_engagement(Key, Site, Input, Opts) ->
    ok = ensure_group(subjects_path(Key, Opts), Opts),
    SubjectID = maps:get(<<"subject-id">>, Input),
    InteractionID = maps:get(<<"interaction-id">>, Input),
    InteractionPath = engagement_path(Key, SubjectID, InteractionID, Opts),
    SubjectPath = subject_path(Key, SubjectID, Opts),
    Existing = read_json(InteractionPath, undefined, Opts),
    Aggregate0 = read_json(SubjectPath, subject_default(SubjectID), Opts),
    Now = now_ms(),
    case Existing of
        undefined ->
            start_engagement(Key, Site, Input, InteractionPath, SubjectPath, Aggregate0, Now, Opts);
        _ ->
            continue_engagement(Key, Input, Existing, InteractionPath, SubjectPath, Aggregate0, Now, Opts)
    end.

start_engagement(Key, Site, Input, InteractionPath, SubjectPath, Aggregate0, Now, Opts) ->
    Event = maps:get(<<"event">>, Input),
    ActiveMS = maps:get(<<"active-ms">>, Input),
    case Event =:= <<"start">> andalso ActiveMS =< engagement_clock_skew_ms(Opts) of
        false ->
            suspicious_engagement(SubjectPath, Aggregate0, 409, <<"Interaction must begin with start.">>, Opts);
        true ->
            Threshold = site_engagement_threshold_ms(Site, Opts),
            Qualified = ActiveMS >= Threshold,
            Interaction0 =
                Input#{
                    <<"qualified">> => Qualified,
                    <<"ended">> => false,
                    <<"started-at">> => Now,
                    <<"last-seen">> => Now,
                    <<"threshold-ms">> => Threshold
                },
            ViewIncrement = qualified_view_increment(Key, Input, Qualified, false, Now, Opts),
            Interaction1 =
                maybe_set_timestamp(
                    maybe_set_timestamp(
                        Interaction0#{ <<"view-counted">> => ViewIncrement =:= 1 },
                        <<"qualified-at">>,
                        Qualified,
                        Now
                    ),
                    <<"view-counted-at">>,
                    ViewIncrement =:= 1,
                    Now
                ),
            Aggregate =
                Aggregate0#{
                    <<"raw">> => int_value(maps:get(<<"raw">>, Aggregate0, 0), 0) + 1,
                    <<"qualified">> =>
                        int_value(maps:get(<<"qualified">>, Aggregate0, 0), 0) + ViewIncrement,
                    <<"active-ms">> =>
                        int_value(maps:get(<<"active-ms">>, Aggregate0, 0), 0) + ActiveMS,
                    <<"updated-at">> => Now
                },
            ok = write_json_entries(#{ InteractionPath => Interaction1, SubjectPath => Aggregate }, Opts),
            {ok, Interaction1, Aggregate, false}
    end.

continue_engagement(Key, Input, Existing, InteractionPath, SubjectPath, Aggregate0, Now, Opts) ->
    case duplicate_engagement(Input, Existing) of
        true ->
            {ok, Existing, Aggregate0, true};
        false ->
            case validate_engagement_transition(Input, Existing, Now, Opts) of
                ok ->
                    ActiveMS = maps:get(<<"active-ms">>, Input),
                    WasQualified = truthy(maps:get(<<"qualified">>, Existing, false)),
                    Threshold = int_value(maps:get(<<"threshold-ms">>, Existing, default_engagement_threshold_ms(Opts)), default_engagement_threshold_ms(Opts)),
                    Qualified = WasQualified orelse ActiveMS >= Threshold,
                    Event = maps:get(<<"event">>, Input),
                    Completed = Event =:= <<"complete">>,
                    Ended = Event =:= <<"end">> orelse Completed,
                    ActiveDelta =
                        ActiveMS - int_value(maps:get(<<"active-ms">>, Existing, 0), 0),
                    ViewIncrement = qualified_view_increment(Key, Input, Qualified, Completed, Now, Opts),
                    Interaction0 =
                        Existing#{
                            <<"event">> => Event,
                            <<"sequence">> => maps:get(<<"sequence">>, Input),
                            <<"active-ms">> => ActiveMS,
                            <<"position-ms">> => maps:get(<<"position-ms">>, Input),
                            <<"qualified">> => Qualified,
                            <<"view-counted">> =>
                                truthy(maps:get(<<"view-counted">>, Existing, false)) orelse ViewIncrement =:= 1,
                            <<"completed">> => Completed,
                            <<"ended">> => Ended,
                            <<"last-seen">> => Now
                        },
                    Interaction1 =
                        maybe_set_timestamp(
                            maybe_set_timestamp(
                                maybe_set_timestamp(
                                    maybe_set_timestamp(
                                        Interaction0,
                                        <<"qualified-at">>,
                                        Qualified,
                                        Now
                                    ),
                                    <<"view-counted-at">>,
                                    ViewIncrement =:= 1,
                                    Now
                                ),
                                <<"completed-at">>,
                                Completed,
                                Now
                            ),
                            <<"ended-at">>,
                            Ended,
                            Now
                        ),
                    Aggregate =
                        Aggregate0#{
                            <<"qualified">> =>
                                int_value(maps:get(<<"qualified">>, Aggregate0, 0), 0) + ViewIncrement,
                            <<"active-ms">> =>
                                int_value(maps:get(<<"active-ms">>, Aggregate0, 0), 0) + ActiveDelta,
                            <<"completions">> =>
                                int_value(maps:get(<<"completions">>, Aggregate0, 0), 0) +
                                    bool_to_int(Completed),
                            <<"updated-at">> => Now
                        },
                    ok = write_json_entries(#{ InteractionPath => Interaction1, SubjectPath => Aggregate }, Opts),
                    {ok, Interaction1, Aggregate, false};
                {error, Status, Reason} ->
                    suspicious_engagement(SubjectPath, Aggregate0, Status, Reason, Opts)
            end
    end.

%% A play is not a view. A subject/viewer pair can contribute one qualified
%% view per configured window. A completed interaction makes a subsequent
%% qualified interaction an evidenced replay; completing an otherwise
%% suppressed interaction also proves that the subject was watched again.
qualified_view_increment(_Key, _Input, false, _Completed, _Now, _Opts) ->
    0;
qualified_view_increment(Key, Input, true, Completed, Now, Opts) ->
    SubjectID = maps:get(<<"subject-id">>, Input),
    InteractionID = maps:get(<<"interaction-id">>, Input),
    ViewerID = maps:get(<<"viewer-id">>, Input),
    Bucket = maps:get(<<"view-bucket">>, Input),
    Path = engagement_view_path(Key, SubjectID, Bucket, ViewerID, Opts),
    Existing = read_json(Path, undefined, Opts),
    case Existing of
        undefined ->
            ok = write_engagement_view(Path, InteractionID, Completed, Now, Opts),
            1;
        _ ->
            ExistingInteraction = maps:get(<<"interaction-id">>, Existing, <<>>),
            ReplayReady = truthy(maps:get(<<"replay-ready">>, Existing, false)),
            case ExistingInteraction =:= InteractionID of
                true ->
                    case Completed andalso not ReplayReady of
                        true -> ok = write_engagement_view(Path, InteractionID, true, Now, Opts);
                        false -> ok
                    end,
                    0;
                false when ReplayReady orelse Completed ->
                    ok = write_engagement_view(Path, InteractionID, Completed, Now, Opts),
                    1;
                false ->
                    0
            end
    end.

write_engagement_view(Path, InteractionID, ReplayReady, Now, Opts) ->
    write_json(
        Path,
        #{
            <<"interaction-id">> => InteractionID,
            <<"replay-ready">> => ReplayReady,
            <<"updated-at">> => Now
        },
        Opts
    ).

maybe_set_timestamp(Map, _Key, false, _Now) ->
    Map;
maybe_set_timestamp(Map, Key, true, Now) ->
    case maps:is_key(Key, Map) of
        true -> Map;
        false -> Map#{ Key => Now }
    end.

duplicate_engagement(Input, Existing) ->
    maps:get(<<"event">>, Input) =:= maps:get(<<"event">>, Existing, undefined) andalso
        maps:get(<<"sequence">>, Input) =:= maps:get(<<"sequence">>, Existing, -1) andalso
        maps:get(<<"active-ms">>, Input) =:= maps:get(<<"active-ms">>, Existing, -1) andalso
        maps:get(<<"position-ms">>, Input) =:= maps:get(<<"position-ms">>, Existing, -1).

validate_engagement_transition(Input, Existing, Now, Opts) ->
    Event = maps:get(<<"event">>, Input),
    Sequence = maps:get(<<"sequence">>, Input),
    ActiveMS = maps:get(<<"active-ms">>, Input),
    PositionMS = maps:get(<<"position-ms">>, Input),
    LastSequence = int_value(maps:get(<<"sequence">>, Existing, -1), -1),
    LastActiveMS = int_value(maps:get(<<"active-ms">>, Existing, 0), 0),
    LastPositionMS = int_value(maps:get(<<"position-ms">>, Existing, 0), 0),
    LastSeen = int_value(maps:get(<<"last-seen">>, Existing, Now), Now),
    Ended = truthy(maps:get(<<"ended">>, Existing, false)),
    MaxActiveDelta = max(0, Now - LastSeen) + engagement_clock_skew_ms(Opts),
    case true of
        _ when Event =:= <<"start">> ->
            {error, 409, <<"Interaction has already started.">>};
        _ when Ended ->
            {error, 409, <<"Interaction has already ended.">>};
        _ when Sequence =< LastSequence ->
            {error, 409, <<"Engagement sequence is not monotonic.">>};
        _ when ActiveMS < LastActiveMS ->
            {error, 422, <<"Active duration regressed.">>};
        _ when PositionMS < LastPositionMS ->
            {error, 422, <<"Engagement position regressed.">>};
        _ when ActiveMS - LastActiveMS > MaxActiveDelta ->
            {error, 422, <<"Active duration exceeds elapsed time.">>};
        true ->
            ok
    end.

suspicious_engagement(SubjectPath, Aggregate0, Status, Reason, Opts) ->
    Aggregate =
        Aggregate0#{
            <<"suspicious">> => int_value(maps:get(<<"suspicious">>, Aggregate0, 0), 0) + 1,
            <<"updated-at">> => now_ms()
        },
    ok = write_json(SubjectPath, Aggregate, Opts),
    {error, Status, Reason}.

set_baseline(Key, Input, Opts) ->
    ok = ensure_group(subjects_path(Key, Opts), Opts),
    SubjectID = maps:get(<<"subject-id">>, Input),
    Path = subject_path(Key, SubjectID, Opts),
    Aggregate0 = read_json(Path, subject_default(SubjectID), Opts),
    case maps:is_key(<<"baseline-version">>, Aggregate0) of
        false ->
            Aggregate =
                Aggregate0#{
                    <<"baseline">> => maps:get(<<"value">>, Input),
                    <<"baseline-version">> => maps:get(<<"version">>, Input),
                    <<"baseline-cutover-at">> => maps:get(<<"cutover-at">>, Input),
                    <<"baseline-source">> => maps:get(<<"source">>, Input),
                    <<"updated-at">> => now_ms()
                },
            ok = write_json(Path, Aggregate, Opts),
            {ok, Aggregate, false};
        true ->
            case same_baseline(Aggregate0, Input) of
                true -> {ok, Aggregate0, true};
                false -> {error, 409, <<"A different baseline already exists for this subject.">>}
            end
    end.

same_baseline(Aggregate, Input) ->
    int_value(maps:get(<<"baseline">>, Aggregate, -1), -1) =:= maps:get(<<"value">>, Input) andalso
        maps:get(<<"baseline-version">>, Aggregate, undefined) =:= maps:get(<<"version">>, Input) andalso
        int_value(maps:get(<<"baseline-cutover-at">>, Aggregate, -1), -1) =:= maps:get(<<"cutover-at">>, Input) andalso
        maps:get(<<"baseline-source">>, Aggregate, <<>>) =:= maps:get(<<"source">>, Input).

subject_default(SubjectID) ->
    #{
        <<"subject-id">> => SubjectID,
        <<"raw">> => 0,
        <<"qualified">> => 0,
        <<"suspicious">> => 0,
        <<"active-ms">> => 0,
        <<"completions">> => 0,
        <<"baseline">> => 0,
        <<"events">> => #{},
        <<"updated-at">> => 0
    }.

public_count(Aggregate) ->
    Baseline = int_value(maps:get(<<"baseline">>, Aggregate, 0), 0),
    Qualified = int_value(maps:get(<<"qualified">>, Aggregate, 0), 0),
    Base =
        #{
            <<"subject-id">> => maps:get(<<"subject-id">>, Aggregate, <<>>),
            <<"raw">> => int_value(maps:get(<<"raw">>, Aggregate, 0), 0),
            <<"qualified">> => Qualified,
            <<"suspicious">> => int_value(maps:get(<<"suspicious">>, Aggregate, 0), 0),
            <<"active-ms">> => int_value(maps:get(<<"active-ms">>, Aggregate, 0), 0),
            <<"completions">> => int_value(maps:get(<<"completions">>, Aggregate, 0), 0),
            <<"baseline">> => Baseline,
            <<"total">> => Baseline + Qualified,
            <<"events">> => map_value(maps:get(<<"events">>, Aggregate, #{})),
            <<"updated-at">> => int_value(maps:get(<<"updated-at">>, Aggregate, 0), 0)
        },
    copy_optional_keys(
        Aggregate,
        Base,
        [<<"baseline-version">>, <<"baseline-cutover-at">>, <<"baseline-source">>]
    ).

public_interaction(Interaction) ->
    maps:with(
        [
            <<"subject-id">>,
            <<"interaction-id">>,
            <<"event">>,
            <<"sequence">>,
            <<"active-ms">>,
            <<"position-ms">>,
            <<"qualified">>,
            <<"view-counted">>,
            <<"completed">>,
            <<"ended">>,
            <<"threshold-ms">>,
            <<"started-at">>,
            <<"last-seen">>,
            <<"qualified-at">>,
            <<"view-counted-at">>,
            <<"completed-at">>,
            <<"ended-at">>
        ],
        Interaction
    ).

copy_optional_keys(Source, Target, Keys) ->
    lists:foldl(
        fun(Key, Acc) ->
            case maps:find(Key, Source) of
                {ok, Value} -> Acc#{ Key => Value };
                error -> Acc
            end
        end,
        Target,
        Keys
    ).

owner_site_for_request(Req, Opts) ->
    case owner_for_request(Req, Opts) of
        {ok, Owner} ->
            case required(<<"key">>, Req, Opts) of
                {ok, Key} ->
                    case read_site(Key, Opts) of
                        undefined ->
                            {error, 404, <<"Unknown tracking key.">>};
                        Site ->
                            case site_wallet_allowed(Site, Owner, Opts) of
                                true -> {ok, Owner, Site};
                                false -> {error, 403, <<"Tracking key is not shared with this wallet.">>}
                            end
                    end;
                {error, Reason} ->
                    {error, 400, Reason}
            end;
        {error, Status, Reason} ->
            {error, Status, Reason}
    end.

baseline_site_for_request(Req, Opts) ->
    case owner_for_request(Req, Opts) of
        {ok, Owner} ->
            case required(<<"key">>, Req, Opts) of
                {ok, Key} ->
                    case read_site(Key, Opts) of
                        undefined ->
                            {error, 404, <<"Unknown tracking key.">>};
                        Site ->
                            case baseline_writer_allowed(Site, Owner, Opts) of
                                true -> {ok, Owner, Site};
                                false -> {error, 403, <<"Wallet cannot import baselines for this site.">>}
                            end
                    end;
                {error, Reason} ->
                    {error, 400, Reason}
            end;
        {error, Status, Reason} ->
            {error, Status, Reason}
    end.

baseline_writer_allowed(Site, Wallet, Opts) ->
    SiteOwner = hb_maps:get(<<"owner">>, Site, <<>>, Opts),
    NodeWriter = truthy(hb_maps:get(<<"node-baseline-writer">>, Site, false, Opts)),
    Wallet =:= SiteOwner orelse
        (NodeWriter andalso Wallet =:= node_wallet_address(Opts)).

owner_for_request(Req, Opts) ->
    case auth_owner(Req, Opts) of
        {ok, Owner} ->
            RequestedOwner = trim_bin(hb_maps:get(<<"owner">>, Req, Owner, Opts)),
            case RequestedOwner of
                Owner -> {ok, Owner};
                <<>> -> {ok, Owner};
                _ -> {error, 403, <<"Authenticated wallet does not match owner.">>}
            end;
        Error ->
            Error
    end.

auth_owner(Req, Opts) ->
    Signers = hb_message:signers(Req, Opts),
    case Signers of
        [Owner | _] ->
            case verified_request(Req, Signers, Opts) of
                true -> {ok, Owner};
                false -> signature_auth_owner(Req, Opts)
            end;
        _ ->
            signature_auth_owner(Req, Opts)
    end.

verified_request(Req, Signers, Opts) ->
    try hb_message:verify(Req, Signers, Opts) of
        true -> true;
        _ -> false
    catch
        _:_ -> false
    end.

signature_auth_owner(Req, Opts) ->
    Owner = trim_bin(hb_maps:get(<<"owner">>, Req, <<>>, Opts)),
    Nonce = trim_bin(hb_maps:get(<<"nonce">>, Req, <<>>, Opts)),
    PubKeyEncoded = trim_bin(hb_maps:get(<<"public-key">>, Req, <<>>, Opts)),
    SigEncoded = trim_bin(hb_maps:get(<<"signature">>, Req, <<>>, Opts)),
    case {Owner, Nonce, PubKeyEncoded, SigEncoded} of
        {<<>>, _, _, _} ->
            {error, 401, <<"Wallet owner authentication is required.">>};
        {_, <<>>, _, _} ->
            {error, 401, <<"Authentication nonce is required.">>};
        {_, _, <<>>, _} ->
            {error, 401, <<"Authentication public key is required.">>};
        {_, _, _, <<>>} ->
            {error, 401, <<"Authentication signature is required.">>};
        _ ->
            verify_dashboard_signature(Owner, Nonce, PubKeyEncoded, SigEncoded, Opts)
    end.

verify_dashboard_signature(Owner, Nonce, PubKeyEncoded, SigEncoded, Opts) ->
    Message = auth_message(Owner, Nonce),
    with_decoded_auth_material(
        PubKeyEncoded,
        SigEncoded,
        fun(PubKey, Sig) ->
            Address = hb_util:human_id(ar_wallet:to_address(PubKey)),
            case Address of
                Owner ->
                    case consume_nonce(Owner, Nonce, Message, Opts) of
                        ok ->
                            case ar_wallet:verify({{rsa, 65537}, PubKey}, Message, Sig) of
                                true -> {ok, Owner};
                                false -> {error, 401, <<"Wallet signature could not be verified.">>}
                            end;
                        {error, Reason} ->
                            {error, 401, Reason}
                    end;
                _ ->
                    {error, 401, <<"Public key does not match owner address.">>}
            end
        end
    ).

with_decoded_auth_material(PubKeyEncoded, SigEncoded, Fun) ->
    case {hb_util:safe_decode(PubKeyEncoded), hb_util:safe_decode(SigEncoded)} of
        {{ok, PubKey}, {ok, Sig}} ->
            Fun(PubKey, Sig);
        {{error, _}, _} ->
            {error, 401, <<"Authentication public key is not valid base64url.">>};
        {_, {error, _}} ->
            {error, 401, <<"Authentication signature is not valid base64url.">>}
    end.

consume_nonce(Owner, Nonce, Message, Opts) ->
    Path = nonce_path(Owner, Nonce, Opts),
    case read_json(Path, undefined, Opts) of
        undefined ->
            {error, <<"Authentication nonce was not found.">>};
        Record ->
            Now = now_ms(),
            Used = hb_maps:get(<<"used">>, Record, false, Opts),
            IssuedAt = int_value(hb_maps:get(<<"issued-at">>, Record, 0, Opts), 0),
            StoredMessage = hb_maps:get(<<"message">>, Record, <<>>, Opts),
            ValidAge = Now - IssuedAt =< nonce_ttl_ms(Opts),
            case {Used, StoredMessage, ValidAge} of
                {false, Message, true} ->
                    ok = write_json(Path, Record#{ <<"used">> => true, <<"used-at">> => Now }, Opts),
                    ok;
                {true, _, _} ->
                    {error, <<"Authentication nonce has already been used.">>};
                {_, _, false} ->
                    {error, <<"Authentication nonce has expired.">>};
                _ ->
                    {error, <<"Authentication nonce does not match request.">>}
            end
    end.

auth_message(Owner, Nonce) ->
    <<"analytics@1.0:", Owner/binary, ":", Nonce/binary>>.

site_key(Req, Opts) ->
    case hb_maps:get(<<"key">>, Req, undefined, Opts) of
        undefined -> random_token(?SITE_KEY_BYTES);
        Key -> path_component(trim_bin(Key))
    end.

site_owner_allowed(undefined, _Owner, _Opts) ->
    true;
site_owner_allowed(Existing, Owner, Opts) ->
    hb_maps:get(<<"owner">>, Existing, undefined, Opts) =:= Owner.

site_wallet_allowed(Site, Wallet, Opts) ->
    lists:member(Wallet, site_access_wallets(Site, Opts)).

site_access_wallets(Site, Opts) ->
    Owner = hb_maps:get(<<"owner">>, Site, <<>>, Opts),
    Users = site_users_from_site(Site, Opts),
    lists:usort([Wallet || Wallet <- [Owner | Users], Wallet =/= <<>>]).

index_site_access(Site, Opts) ->
    Key = hb_maps:get(<<"key">>, Site, <<>>, Opts),
    Entries =
        maps:from_list(
            [
                {owner_site_path(Wallet, Key, Opts), Key}
             || Wallet <- site_access_wallets(Site, Opts)
            ]
        ),
    hb_store:write(Entries, Opts).

site_record(undefined, Key, Owner, Req, Now, Opts) ->
    #{
        <<"key">> => Key,
        <<"owner">> => Owner,
        <<"name">> => site_name(Req, Opts),
        <<"origins">> => allowed_origins(Req, Opts),
        <<"users">> => site_users(Req, Owner, Opts),
        <<"visitor-id-mode">> => visitor_id_mode(Req, Opts),
        <<"engagement-threshold-ms">> => engagement_threshold_ms(Req, Opts),
        <<"engagement-dedupe-window-ms">> => engagement_dedupe_window_ms(Req, Opts),
        <<"created-at">> => Now,
        <<"updated-at">> => Now,
        <<"enabled">> => true
    };
site_record(Existing, Key, Owner, Req, Now, Opts) ->
    Existing#{
        <<"key">> => Key,
        <<"owner">> => Owner,
        <<"name">> => site_name(Req, hb_maps:get(<<"name">>, Existing, <<"Untitled site">>, Opts), Opts),
        <<"origins">> => allowed_origins(Req, hb_maps:get(<<"origins">>, Existing, [], Opts), Opts),
        <<"users">> => site_users(Req, hb_maps:get(<<"users">>, Existing, [], Opts), Owner, Opts),
        <<"visitor-id-mode">> =>
            visitor_id_mode(
                Req,
                site_visitor_id_mode(Existing, Opts),
                Opts
            ),
        <<"engagement-threshold-ms">> =>
            engagement_threshold_ms(
                Req,
                int_value(
                    hb_maps:get(
                        <<"engagement-threshold-ms">>,
                        Existing,
                        default_engagement_threshold_ms(Opts),
                        Opts
                    ),
                    default_engagement_threshold_ms(Opts)
                ),
                Opts
            ),
        <<"engagement-dedupe-window-ms">> =>
            engagement_dedupe_window_ms(
                Req,
                int_value(
                    hb_maps:get(
                        <<"engagement-dedupe-window-ms">>,
                        Existing,
                        default_engagement_dedupe_window_ms(Opts),
                        Opts
                    ),
                    default_engagement_dedupe_window_ms(Opts)
                ),
                Opts
            ),
        <<"updated-at">> => Now,
        <<"enabled">> => truthy(hb_maps:get(<<"enabled">>, Req, true, Opts))
    }.

site_name(Req, Opts) ->
    site_name(Req, <<"Untitled site">>, Opts).

site_name(Req, Default, Opts) ->
    Name = trim_bin(hb_maps:get(<<"name">>, Req, Default, Opts)),
    case Name of
        <<>> -> Default;
        _ -> limit_binary(Name, 120)
    end.

visitor_id_mode(Req, Opts) ->
    visitor_id_mode(Req, <<"daily">>, Opts).

visitor_id_mode(Req, Default, Opts) ->
    case to_lower_bin(hb_maps:get(<<"visitor-id-mode">>, Req, Default, Opts)) of
        <<"persistent">> -> <<"persistent">>;
        _ -> <<"daily">>
    end.

site_visitor_id_mode(Site, Opts) ->
    visitor_id_mode(Site, <<"daily">>, Opts).

allowed_origins(Req, Opts) ->
    allowed_origins(Req, [], Opts).

allowed_origins(Req, Default, Opts) ->
    Raw =
        hb_ao:get_first(
            [
                {Req, <<"origins">>},
                {Req, <<"allowed-origins">>},
                {Req, <<"origin">>},
                {Req, <<"domain">>}
            ],
            Default,
            Opts
        ),
    Origins0 =
        case Raw of
            List when is_list(List) -> [trim_bin(Item) || Item <- List];
            Bin when is_binary(Bin) -> [trim_bin(Item) || Item <- binary:split(Bin, <<",">>, [global])];
            _ -> []
        end,
    Origins =
        [
            normalize_origin(Origin)
         || Origin <- Origins0,
            Origin =/= <<>>
        ],
    lists:usort([Origin || Origin <- Origins, Origin =/= <<>>]).

site_users(Req, Owner, Opts) ->
    site_users(Req, [], Owner, Opts).

site_users(Req, Default, Owner, Opts) ->
    Raw =
        hb_ao:get_first(
            [
                {Req, <<"users">>},
                {Req, <<"wallets">>},
                {Req, <<"members">>},
                {Req, <<"invites">>},
                {Req, <<"allowed-wallets">>}
            ],
            Default,
            Opts
        ),
    Users0 = parse_binary_list(Raw),
    Users1 = [limit_binary(User, 128) || User <- Users0, User =/= <<>>, User =/= Owner],
    lists:sublist(lists:usort(Users1), 50).

site_users_from_site(Site, Opts) ->
    parse_binary_list(hb_maps:get(<<"users">>, Site, [], Opts)).

parse_binary_list(Value) when is_list(Value) ->
    [trim_bin(Item) || Item <- Value];
parse_binary_list(Value) when is_binary(Value) ->
    [trim_bin(Item) || Item <- binary:split(Value, <<",">>, [global])];
parse_binary_list(_) ->
    [].

normalize_origin(<<"*">>) ->
    <<"*">>;
normalize_origin(Origin) ->
    Trimmed = trim_bin(Origin),
    case binary:split(Trimmed, <<"://">>) of
        [Scheme, Rest] ->
            %% Reduce to the bare origin (scheme://host[:port]). A browser's
            %% `Origin' header never includes a path, query or fragment, so a
            %% registered origin entered as a full URL must be trimmed the same
            %% way or it will never match.
            Authority =
                strip_url_tail(
                    strip_url_tail(strip_url_tail(Rest, <<"/">>), <<"?">>),
                    <<"#">>
                ),
            <<Scheme/binary, "://", Authority/binary>>;
        [_] ->
            strip_trailing_slash(Trimmed)
    end.

origin_allowed(Site, Req, Opts) ->
    %% Normalize the stored origins too (not just the request's), so records
    %% registered before origin normalization tightened — e.g. a full URL like
    %% "https://site/#" from a hash-router address bar — still match a browser's
    %% bare `Origin' header without needing re-registration.
    Origins =
        [normalize_origin(Origin) || Origin <- hb_maps:get(<<"origins">>, Site, [], Opts)],
    case Origins of
        [] ->
            true;
        _ ->
            lists:member(<<"*">>, Origins) orelse
                lists:member(
                    normalize_origin(hb_maps:get(<<"origin">>, Req, <<>>, Opts)),
                    Origins
                )
    end.

registration_response(Site, Req, Opts) ->
    Key = hb_maps:get(<<"key">>, Site, undefined, Opts),
    Base = request_base_url(Req, Opts),
    #{
        <<"site">> => public_site(Site, Opts),
        <<"key">> => Key,
        <<"script-path">> => script_path(Key),
        <<"script-src">> => absolute_script_url(Base, Key),
        <<"snippet">> => script_tag(Base, Key)
    }.

public_site(Site, Opts) ->
    #{
        <<"key">> => hb_maps:get(<<"key">>, Site, undefined, Opts),
        <<"owner">> => hb_maps:get(<<"owner">>, Site, undefined, Opts),
        <<"name">> => hb_maps:get(<<"name">>, Site, <<"Untitled site">>, Opts),
        <<"origins">> => hb_maps:get(<<"origins">>, Site, [], Opts),
        <<"users">> => site_users_from_site(Site, Opts),
        <<"visitor-id-mode">> => site_visitor_id_mode(Site, Opts),
        <<"engagement-threshold-ms">> =>
            int_value(
                hb_maps:get(
                    <<"engagement-threshold-ms">>,
                    Site,
                    default_engagement_threshold_ms(Opts),
                    Opts
                ),
                default_engagement_threshold_ms(Opts)
            ),
        <<"engagement-dedupe-window-ms">> =>
            engagement_dedupe_window_ms(Site, Opts),
        <<"created-at">> => hb_maps:get(<<"created-at">>, Site, 0, Opts),
        <<"updated-at">> => hb_maps:get(<<"updated-at">>, Site, 0, Opts),
        <<"enabled">> => hb_maps:get(<<"enabled">>, Site, true, Opts)
    }.

script_path(Key) ->
    <<"/~analytics@1.0/script?key=", Key/binary>>.

%% @doc Absolute URL for the tracker script, used when embedding on a
%% third-party site. Falls back to the root-relative path when no base URL
%% could be derived from the request.
absolute_script_url(<<>>, Key) ->
    script_path(Key);
absolute_script_url(Base, Key) ->
    <<Base/binary, (script_path(Key))/binary>>.

script_tag(Base, Key) ->
    Src = absolute_script_url(Base, Key),
    <<"<script async src=\"", Src/binary, "\"></script>">>.

%% @doc Build a best-effort absolute base URL (`scheme://host[:port]') for
%% embedding the tracker on a third-party site, derived from the inbound
%% request. Honors `x-forwarded-proto'/`x-forwarded-host' when a reverse proxy
%% sets them, otherwise falls back to the request host plus the node's
%% configured port. Returns `<<>>' when no host is known, in which case callers
%% use a root-relative path. The dashboard rebuilds this from the browser's own
%% origin (which is authoritative behind proxies/TLS); this value is for
%% non-dashboard (e.g. API) consumers.
request_base_url(Req, Opts) ->
    case request_host(Req, Opts) of
        <<>> -> <<>>;
        Host ->
            Scheme = request_scheme(Req, Opts),
            <<Scheme/binary, "://", Host/binary>>
    end.

request_scheme(Req, Opts) ->
    case trim_bin(hb_maps:get(<<"x-forwarded-proto">>, Req, <<>>, Opts)) of
        <<"https">> -> <<"https">>;
        _ -> <<"http">>
    end.

request_host(Req, Opts) ->
    case trim_bin(hb_maps:get(<<"x-forwarded-host">>, Req, <<>>, Opts)) of
        <<>> ->
            host_with_node_port(trim_bin(hb_maps:get(<<"host">>, Req, <<>>, Opts)), Opts);
        Forwarded ->
            Forwarded
    end.

host_with_node_port(<<>>, _Opts) ->
    <<>>;
host_with_node_port(Host, Opts) ->
    case binary:match(Host, <<":">>) of
        nomatch ->
            case node_port(Opts) of
                80 -> Host;
                443 -> Host;
                Port -> <<Host/binary, ":", (integer_to_binary(Port))/binary>>
            end;
        _ ->
            Host
    end.

node_port(Opts) ->
    int_value(hb_opts:get(port, 8734, Opts), 8734).

update_visit_and_daily(
    Key,
    Date,
    VisitID,
    Page,
    Event,
    Duration,
    Demographics0,
    Dimensions,
    VisitorHash,
    PersistentVisitor,
    Opts
) ->
    Path = visit_path(Key, Date, VisitID, Opts),
    Now = now_ms(),
    Existing = read_json(Path, undefined, Opts),
    ExistingDuration =
        case Existing of
            undefined -> 0;
            _ -> int_value(hb_maps:get(<<"duration-ms">>, Existing, 0, Opts), 0)
        end,
    NewDuration = max(ExistingDuration, Duration),
    Demographics = visit_demographics(Existing, Demographics0, Opts),
    IP = hb_maps:get(<<"ip">>, Demographics, <<"unknown">>, Opts),
    Location = map_value(hb_maps:get(<<"location">>, Demographics, #{}, Opts)),
    NewVisit = Existing =:= undefined,
    PrevEnded =
        case Existing of
            undefined -> false;
            _ -> is_ended(hb_maps:get(<<"ended">>, Existing, false, Opts))
        end,
    %% Once a page-view sends `end' (tab close, or SPA navigation away) it is no
    %% longer a live visitor, even though the `end' ping itself refreshes
    %% `last-seen'. Without this an ended visit keeps counting as active for the
    %% whole window. `end' is sticky so a late stray ping cannot revive it.
    Ended = PrevEnded orelse Event =:= <<"end">>,
    Visit =
        case Existing of
            undefined ->
                #{
                    <<"visit">> => VisitID,
                    <<"date">> => Date,
                    <<"page">> => Page,
                    <<"first-seen">> => Now,
                    <<"last-seen">> => Now,
                    <<"duration-ms">> => NewDuration,
                    <<"events">> => 1,
                    <<"last-event">> => Event,
                    <<"ip">> => IP,
                    <<"location">> => Location,
                    <<"dimensions">> => Dimensions,
                    <<"ended">> => Ended
                };
            _ ->
                Existing#{
                    <<"page">> => hb_maps:get(<<"page">>, Existing, Page, Opts),
                    <<"last-seen">> => Now,
                    <<"duration-ms">> => NewDuration,
                    <<"events">> => int_value(hb_maps:get(<<"events">>, Existing, 0, Opts), 0) + 1,
                    <<"last-event">> => Event,
                    <<"ip">> => IP,
                    <<"location">> => Location,
                    <<"dimensions">> =>
                        map_value(hb_maps:get(<<"dimensions">>, Existing, Dimensions, Opts)),
                    <<"ended">> => Ended
                }
        end,
    ok = write_json(Path, Visit, Opts),
    %% Unique visitors + sessions are only resolved on the first ping of a new
    %% page-view (NewVisit), so heartbeats/end pings just extend duration.
    NewVisitor = NewVisit andalso mark_visitor(Key, Date, VisitorHash, Opts),
    %% A page view counts once per (visitor, page) per day: revisiting a page, or
    %% visiting another route that normalizes to the same one-level page, does not
    %% add a view. Duration/active tracking still uses the per-navigation visit
    %% record above, so time-on-page keeps accumulating.
    CountView = NewVisit andalso mark_page_view(Key, Date, VisitorHash, Page, Opts),
    Session =
        session_context(
            Key,
            Date,
            VisitorHash,
            Page,
            Now,
            NewVisit,
            NewDuration,
            Dimensions,
            Opts
        ),
    Ctx =
        #{
            <<"new-visit">> => NewVisit,
            <<"count-view">> => CountView,
            <<"old-duration">> => ExistingDuration,
            <<"new-duration">> => NewDuration,
            <<"demographics">> => Demographics,
            <<"dimensions">> => Dimensions,
            <<"new-visitor">> => NewVisitor,
            <<"persistent-visitor">> => PersistentVisitor,
            <<"session">> => Session
        },
    ok = update_daily(Key, Date, Page, Ctx, Opts),
    {ok, Visit}.

visit_demographics(undefined, Demographics, _Opts) ->
    Demographics;
visit_demographics(Existing, Demographics, Opts) ->
    ExistingIP = hb_maps:get(<<"ip">>, Existing, <<>>, Opts),
    ExistingLocation = map_value(hb_maps:get(<<"location">>, Existing, #{}, Opts)),
    #{
        <<"ip">> =>
            case ExistingIP of
                <<>> -> hb_maps:get(<<"ip">>, Demographics, <<"unknown">>, Opts);
                _ -> ExistingIP
            end,
        <<"location">> =>
            case map_size(ExistingLocation) of
                0 -> hb_maps:get(<<"location">>, Demographics, #{}, Opts);
                _ -> ExistingLocation
            end
    }.

update_daily(Key, Date, Page, Ctx, Opts) ->
    Path = daily_path(Key, Date, Opts),
    Daily0 = normalize_daily(Date, read_json(Path, daily_default(Date), Opts)),
    Demographics = hb_maps:get(<<"demographics">>, Ctx, #{}, Opts),
    Dimensions = hb_maps:get(<<"dimensions">>, Ctx, #{}, Opts),
    CountView = hb_maps:get(<<"count-view">>, Ctx, false, Opts),
    OldDuration = int_value(hb_maps:get(<<"old-duration">>, Ctx, 0, Opts), 0),
    NewDuration = int_value(hb_maps:get(<<"new-duration">>, Ctx, 0, Opts), 0),
    Session = map_value(hb_maps:get(<<"session">>, Ctx, #{}, Opts)),
    NewVisitor = hb_maps:get(<<"new-visitor">>, Ctx, false, Opts),
    PageLoadIncrement = bool_to_int(hb_maps:get(<<"new-visit">>, Ctx, false, Opts)),
    Delta = max(0, NewDuration - OldDuration),
    VisitIncrement =
        case CountView of
            true -> 1;
            false -> 0
        end,
    ByPath0 = map_value(hb_maps:get(<<"by-path">>, Daily0, #{}, Opts)),
    ByIP0 = map_value(hb_maps:get(<<"by-ip">>, Daily0, #{}, Opts)),
    ByLocation0 = map_value(hb_maps:get(<<"by-location">>, Daily0, #{}, Opts)),
    Page0 = normalize_page_stats(hb_maps:get(Page, ByPath0, #{}, Opts)),
    IP = demographic_ip(Demographics, Opts),
    Location = demographic_location(Demographics, Opts),
    LocationLabel = location_label(Location, Opts),
    Page1 =
        Page0#{
            <<"page-loads">> =>
                int_value(hb_maps:get(<<"page-loads">>, Page0, 0, Opts), 0) +
                    PageLoadIncrement,
            <<"visits">> => int_value(hb_maps:get(<<"visits">>, Page0, 0, Opts), 0) + VisitIncrement,
            <<"duration-ms">> =>
                int_value(hb_maps:get(<<"duration-ms">>, Page0, 0, Opts), 0) + Delta,
            <<"max-duration-ms">> =>
                max(
                    int_value(hb_maps:get(<<"max-duration-ms">>, Page0, 0, Opts), 0),
                    NewDuration
                ),
            %% Per-page demographic buckets, scoped to whichever page this ping
            %% is for -- exactly like `visits'/`duration-ms' above, using the
            %% same generic bucket helper as the site-wide copies below.
            <<"by-ip">> =>
                update_demographic_bucket(
                    map_value(maps:get(<<"by-ip">>, Page0, #{})),
                    IP,
                    #{ <<"ip">> => IP },
                    VisitIncrement,
                    Delta,
                    NewDuration
                ),
            <<"by-location">> =>
                update_demographic_bucket(
                    map_value(maps:get(<<"by-location">>, Page0, #{})),
                    LocationLabel,
                    Location#{ <<"location">> => LocationLabel },
                    VisitIncrement,
                    Delta,
                    NewDuration
                )
        },
    %% Per-page acquisition + technology dimension buckets, same fold as the
    %% site-wide copy below, applied to the page bucket instead of the daily one.
    Page2 = fold_dimension_buckets(Page1, Dimensions, VisitIncrement, Delta, NewDuration),
    ByIP1 =
        update_demographic_bucket(
            ByIP0,
            IP,
            #{ <<"ip">> => IP },
            VisitIncrement,
            Delta,
            NewDuration
        ),
    ByLocation1 =
        update_demographic_bucket(
            ByLocation0,
            LocationLabel,
            Location#{ <<"location">> => LocationLabel },
            VisitIncrement,
            Delta,
            NewDuration
        ),
    Daily1 =
        Daily0#{
            <<"date">> => Date,
            <<"page-loads">> =>
                int_value(hb_maps:get(<<"page-loads">>, Daily0, 0, Opts), 0) +
                    PageLoadIncrement,
            <<"visits">> =>
                int_value(hb_maps:get(<<"visits">>, Daily0, 0, Opts), 0) + VisitIncrement,
            <<"duration-ms">> =>
                int_value(hb_maps:get(<<"duration-ms">>, Daily0, 0, Opts), 0) + Delta,
            <<"max-duration-ms">> =>
                max(
                    int_value(hb_maps:get(<<"max-duration-ms">>, Daily0, 0, Opts), 0),
                    NewDuration
                ),
            <<"by-path">> => ByPath0#{ Page => Page2 },
            <<"by-ip">> => ByIP1,
            <<"by-location">> => ByLocation1,
            <<"updated-at">> => now_ms()
        },
    %% Acquisition + technology dimension buckets (referrer, UTM, device,
    %% browser, OS, language) fold in exactly like by-ip/by-location.
    Daily2 = fold_dimension_buckets(Daily1, Dimensions, VisitIncrement, Delta, NewDuration),
    %% Unique-visitor + session counters, landing/exit page counts, and their
    %% per-page mirrors on `by-path[Page]'/`by-path[EntryPage]'.
    Daily3 = apply_session_counters(Daily2, Session, NewVisitor, Page),
    PersistentVisitor = hb_maps:get(<<"persistent-visitor">>, Ctx, undefined, Opts),
    Daily4 = apply_persistent_visitor(Daily3, PersistentVisitor, Demographics, Dimensions),
    Daily5 = apply_acquisition_attribution(Daily4, Session, PersistentVisitor, Delta),
    write_json(Path, Daily5, Opts).

summary_from_days(Key, Daily, Route, Opts) ->
    PageLoads = lists:sum([int_value(hb_maps:get(<<"page-loads">>, Day, 0, Opts), 0) || Day <- Daily]),
    Visits = lists:sum([int_value(hb_maps:get(<<"visits">>, Day, 0, Opts), 0) || Day <- Daily]),
    Uniques = lists:sum([int_value(hb_maps:get(<<"unique-visitors">>, Day, 0, Opts), 0) || Day <- Daily]),
    Sessions = lists:sum([int_value(hb_maps:get(<<"sessions">>, Day, 0, Opts), 0) || Day <- Daily]),
    EngagedSessions =
        lists:sum([int_value(hb_maps:get(<<"engaged-sessions">>, Day, 0, Opts), 0) || Day <- Daily]),
    Bounces = lists:sum([int_value(hb_maps:get(<<"bounces">>, Day, 0, Opts), 0) || Day <- Daily]),
    TotalEvents = lists:sum([int_value(hb_maps:get(<<"events">>, Day, 0, Opts), 0) || Day <- Daily]),
    TotalDuration =
        lists:sum([int_value(hb_maps:get(<<"duration-ms">>, Day, 0, Opts), 0) || Day <- Daily]),
    MaxDuration =
        lists:foldl(
            fun(Day, Acc) ->
                max(Acc, int_value(hb_maps:get(<<"max-duration-ms">>, Day, 0, Opts), 0))
            end,
            0,
            Daily
        ),
    Audience = audience_from_days(Daily),
    #{
        <<"page-loads">> => PageLoads,
        <<"visits">> => Visits,
        <<"unique-visitors">> => Uniques,
        <<"sessions">> => Sessions,
        <<"engaged-sessions">> => EngagedSessions,
        <<"engagement-rate">> => ratio(EngagedSessions, Sessions),
        <<"bounces">> => Bounces,
        <<"bounce-rate">> => ratio(Bounces, Sessions),
        <<"pages-per-session">> => ratio(Visits, Sessions),
        <<"events">> => TotalEvents,
        <<"duration-ms">> => TotalDuration,
        <<"avg-duration-ms">> => average(TotalDuration, Visits),
        <<"avg-session-duration-ms">> => average(TotalDuration, Sessions),
        <<"max-duration-ms">> => MaxDuration,
        <<"active-users">> => maps:get(<<"active-users">>, Audience, 0),
        <<"new-users">> => maps:get(<<"new-users">>, Audience, 0),
        <<"returning-users">> => maps:get(<<"returning-users">>, Audience, 0),
        <<"active">> => active_visits(Key, Route, Opts),
        <<"active-pages">> => active_pages(Key, Route, Opts)
    }.

ratio(_Numerator, Denominator) when Denominator =< 0 ->
    0.0;
ratio(Numerator, Denominator) ->
    Numerator / Denominator.

public_daily(Day) ->
    maps:without([<<"stable-visitors">>, <<"stable-visitor-dimensions">>], Day).

audience_from_days(Daily) ->
    StableVisitors = stable_visitors_from_days(Daily),
    HasPersistentVisitors = map_size(StableVisitors) > 0,
    ActiveUsers =
        case HasPersistentVisitors of
            true -> map_size(StableVisitors);
            false -> sum_daily_unique_visitors(Daily)
        end,
    Active1 = active_users_for_window(Daily, 1, HasPersistentVisitors),
    Active7 = active_users_for_window(Daily, 7, HasPersistentVisitors),
    Active28 = active_users_for_window(Daily, 28, HasPersistentVisitors),
    DateSet = maps:from_list([{maps:get(<<"date">>, Day, <<>>), true} || Day <- Daily]),
    NewUsers =
        case HasPersistentVisitors of
            true ->
                map_size(
                    maps:filter(
                        fun(_Visitor, FirstSeen) -> maps:is_key(FirstSeen, DateSet) end,
                        StableVisitors
                    )
                );
            false -> 0
        end,
    #{
        <<"persistent-identification">> => HasPersistentVisitors,
        <<"active-users">> => ActiveUsers,
        <<"new-users">> => NewUsers,
        <<"returning-users">> => max(0, ActiveUsers - NewUsers),
        <<"active-1-day-users">> => Active1,
        <<"active-7-day-users">> => Active7,
        <<"active-28-day-users">> => Active28,
        <<"dau-per-wau">> => ratio(Active1, Active7),
        <<"dau-per-mau">> => ratio(Active1, Active28),
        <<"wau-per-mau">> => ratio(Active7, Active28),
        <<"breakdowns">> => audience_breakdowns(Daily)
    }.

active_users_for_window(Daily, Window, true) ->
    map_size(stable_visitors_from_days(take_last(Daily, Window)));
active_users_for_window(Daily, Window, false) ->
    sum_daily_unique_visitors(take_last(Daily, Window)).

sum_daily_unique_visitors(Daily) ->
    lists:sum([int_value(maps:get(<<"unique-visitors">>, Day, 0), 0) || Day <- Daily]).

stable_visitors_from_days(Daily) ->
    lists:foldl(
        fun(Day, Acc) -> maps:merge(Acc, map_value(maps:get(<<"stable-visitors">>, Day, #{}))) end,
        #{},
        Daily
    ).

audience_breakdowns(Daily) ->
    VisitorDimensions =
        lists:foldl(
            fun(Day, Acc) ->
                maps:merge(
                    Acc,
                    map_value(maps:get(<<"stable-visitor-dimensions">>, Day, #{}))
                )
            end,
            #{},
            Daily
        ),
    #{
        <<"countries">> => audience_dimension_items(VisitorDimensions, <<"country">>),
        <<"regions">> => audience_dimension_items(VisitorDimensions, <<"region">>),
        <<"cities">> => audience_dimension_items(VisitorDimensions, <<"city">>),
        <<"devices">> => audience_dimension_items(VisitorDimensions, <<"device">>),
        <<"browsers">> => audience_dimension_items(VisitorDimensions, <<"browser">>),
        <<"operating-systems">> => audience_dimension_items(VisitorDimensions, <<"os">>),
        <<"languages">> => audience_dimension_items(VisitorDimensions, <<"language">>)
    }.

audience_dimension_items(VisitorDimensions, Field) ->
    Counts =
        maps:fold(
            fun(_Visitor, RawDimensions, Acc) ->
                Label = dimension_label(maps:get(Field, map_value(RawDimensions), <<>>)),
                maps:update_with(Label, fun(Count) -> Count + 1 end, 1, Acc)
            end,
            #{},
            VisitorDimensions
        ),
    lists:sublist(
        lists:sort(
            fun(A, B) -> maps:get(<<"active-users">>, A) >= maps:get(<<"active-users">>, B) end,
            [
                #{ Field => Label, <<"active-users">> => Count }
             || {Label, Count} <- maps:to_list(Counts)
            ]
        ),
        50
    ).

take_last(List, Count) ->
    Length = length(List),
    lists:nthtail(max(0, Length - min(Length, Count)), List).

retention_from_days(Daily) ->
    Dates = [maps:get(<<"date">>, Day, <<>>) || Day <- Daily],
    DateVisitors =
        maps:from_list(
            [
                {maps:get(<<"date">>, Day, <<>>), map_value(maps:get(<<"stable-visitors">>, Day, #{}))}
             || Day <- Daily
            ]
        ),
    AllVisitors = stable_visitors_from_days(Daily),
    CohortDates =
        lists:sort(
            lists:usort(
                [FirstSeen || FirstSeen <- maps:values(AllVisitors), lists:member(FirstSeen, Dates)]
            )
        ),
    Windows = [1, 7, 14, 30],
    #{
        <<"windows">> => Windows,
        <<"cohorts">> =>
            [retention_cohort(Date, AllVisitors, DateVisitors, Windows) || Date <- CohortDates]
    }.

retention_cohort(CohortDate, AllVisitors, DateVisitors, Windows) ->
    Cohort = maps:filter(fun(_Visitor, FirstSeen) -> FirstSeen =:= CohortDate end, AllVisitors),
    CohortSize = map_size(Cohort),
    #{
        <<"cohort-date">> => CohortDate,
        <<"new-users">> => CohortSize,
        <<"retention">> =>
            [retention_checkpoint(CohortDate, Cohort, CohortSize, DateVisitors, Window) || Window <- Windows]
    }.

retention_checkpoint(CohortDate, Cohort, CohortSize, DateVisitors, Window) ->
    TargetDate = add_iso_days(CohortDate, Window),
    Eligible = maps:is_key(TargetDate, DateVisitors),
    Active =
        case Eligible of
            true -> map_intersection_size(Cohort, maps:get(TargetDate, DateVisitors));
            false -> 0
        end,
    #{
        <<"day">> => Window,
        <<"date">> => TargetDate,
        <<"eligible">> => Eligible,
        <<"active-users">> => Active,
        <<"retention-rate">> => ratio(Active, CohortSize)
    }.

map_intersection_size(Left, Right) ->
    maps:fold(
        fun(Key, _Value, Count) ->
            case maps:is_key(Key, Right) of
                true -> Count + 1;
                false -> Count
            end
        end,
        0,
        Left
    ).

add_iso_days(Date, Offset) ->
    try
        [Y, M, D] = [binary_to_integer(Part) || Part <- binary:split(Date, <<"-">>, [global])],
        Gregorian = calendar:date_to_gregorian_days(Y, M, D),
        date_string(calendar:gregorian_days_to_date(Gregorian + Offset))
    catch
        _:_ -> <<>>
    end.

%% @doc Fold `by-path' across the requested day range into a per-page mini
%% report: totals (visits/duration/sessions/bounces) plus the same
%% demographics/acquisition/technology/events shape as the site-wide report,
%% scoped to that one page. This is what lets the dashboard sum matching
%% pages client-side for every stat a route filter touches, exactly like it
%% already does for `visits'/`duration-ms'.
pages_from_days(Daily) ->
    PagesMap =
        lists:foldl(
            fun(Day, Acc) ->
                ByPath = map_value(maps:get(<<"by-path">>, Day, #{})),
                maps:fold(
                    fun(Page, RawStats, PageAcc) ->
                        Existing = maps:get(Page, PageAcc, #{}),
                        PageAcc#{ Page => merge_page_stats(Existing, RawStats) }
                    end,
                    Acc,
                    ByPath
                )
            end,
            #{},
            Daily
        ),
    Entries = [page_metric_from_stats(Page, Stats) || {Page, Stats} <- maps:to_list(PagesMap)],
    lists:sort(
        fun(A, B) ->
            maps:get(<<"visits">>, A, 0) >= maps:get(<<"visits">>, B, 0)
        end,
        Entries
    ).

%% @doc Combine two (already-normalized-or-not) `by-path' entries for the same
%% page across two different days: sum the counters, take the max of
%% `max-duration-ms', and merge the dimension buckets label-by-label via
%% `merge_demographic_buckets/2'.
merge_page_stats(RawA, RawB) ->
    A = normalize_page_stats(RawA),
    B = normalize_page_stats(RawB),
    Base =
        #{
            <<"page-loads">> =>
                int_value(maps:get(<<"page-loads">>, A, 0), 0) +
                    int_value(maps:get(<<"page-loads">>, B, 0), 0),
            <<"visits">> => int_value(maps:get(<<"visits">>, A, 0), 0) + int_value(maps:get(<<"visits">>, B, 0), 0),
            <<"duration-ms">> =>
                int_value(maps:get(<<"duration-ms">>, A, 0), 0) + int_value(maps:get(<<"duration-ms">>, B, 0), 0),
            <<"max-duration-ms">> =>
                max(
                    int_value(maps:get(<<"max-duration-ms">>, A, 0), 0),
                    int_value(maps:get(<<"max-duration-ms">>, B, 0), 0)
                ),
            <<"sessions">> => int_value(maps:get(<<"sessions">>, A, 0), 0) + int_value(maps:get(<<"sessions">>, B, 0), 0),
            <<"bounces">> => int_value(maps:get(<<"bounces">>, A, 0), 0) + int_value(maps:get(<<"bounces">>, B, 0), 0)
        },
    WithDimensions =
        lists:foldl(
            fun(BucketKey, Acc) ->
                Acc#{
                    BucketKey =>
                        merge_demographic_buckets(
                            map_value(maps:get(BucketKey, A, #{})),
                            map_value(maps:get(BucketKey, B, #{}))
                        )
                }
            end,
            Base,
            ?PAGE_DIMENSION_BUCKET_KEYS
        ),
    WithDimensions#{
        <<"by-event">> =>
            merge_event_buckets(
                map_value(maps:get(<<"by-event">>, A, #{})),
                map_value(maps:get(<<"by-event">>, B, #{}))
            ),
        <<"by-action">> =>
            merge_event_buckets(
                map_value(maps:get(<<"by-action">>, A, #{})),
                map_value(maps:get(<<"by-action">>, B, #{}))
            )
    }.

%% @doc Merge two already-aggregated demographic/dimension bucket maps
%% (label -> stats) by summing visits/duration and taking the max of
%% max-duration, reusing `update_demographic_bucket/6' with the second
%% bucket's own totals as its "increment" rather than a single ping's.
merge_demographic_buckets(BucketA, BucketB) ->
    maps:fold(
        fun(Label, RawStats, Acc) ->
            Stats = normalize_demographic_stats(RawStats),
            Visits = int_value(maps:get(<<"visits">>, Stats, 0), 0),
            Duration = int_value(maps:get(<<"duration-ms">>, Stats, 0), 0),
            MaxDuration = int_value(maps:get(<<"max-duration-ms">>, Stats, 0), 0),
            Extra = maps:without([<<"visits">>, <<"duration-ms">>, <<"max-duration-ms">>], Stats),
            update_demographic_bucket(Acc, Label, Extra, Visits, Duration, MaxDuration)
        end,
        BucketA,
        map_value(BucketB)
    ).

merge_event_buckets(BucketA, BucketB) ->
    maps:fold(
        fun(Name, RawStats, Acc) ->
            Stats = normalize_event_stats(RawStats),
            Existing = normalize_event_stats(maps:get(Name, Acc, #{})),
            Acc#{
                Name =>
                    #{
                        <<"count">> =>
                            int_value(maps:get(<<"count">>, Existing, 0), 0) +
                                int_value(maps:get(<<"count">>, Stats, 0), 0),
                        <<"value">> =>
                            int_value(maps:get(<<"value">>, Existing, 0), 0) +
                                int_value(maps:get(<<"value">>, Stats, 0), 0)
                    }
            }
        end,
        BucketA,
        map_value(BucketB)
    ).

%% @doc Convert an already-merged bucket map (label -> stats, each carrying its
%% own label sub-field from `Extra' above) into the same sorted-top-50 shape
%% the site-wide report uses, without re-folding across days.
bucket_map_to_list(BucketMap) ->
    lists:sublist(
        lists:sort(
            fun(A, B) -> maps:get(<<"visits">>, A, 0) >= maps:get(<<"visits">>, B, 0) end,
            maps:values(map_value(BucketMap))
        ),
        50
    ).

event_bucket_to_list(BucketMap, Sessions) ->
    Rows =
        [
            #{
                <<"name">> => Name,
                <<"count">> => maps:get(<<"count">>, Stats, 0),
                <<"value">> => maps:get(<<"value">>, Stats, 0),
                <<"conversion-rate">> => conversion_rate(maps:get(<<"count">>, Stats, 0), Sessions)
            }
         || {Name, Stats} <- maps:to_list(map_value(BucketMap))
        ],
    lists:sublist(
        lists:sort(fun(A, B) -> maps:get(<<"count">>, A, 0) >= maps:get(<<"count">>, B, 0) end, Rows),
        50
    ).

page_metric_from_stats(Page, Stats) ->
    #{
        <<"page">> => Page,
        <<"page-loads">> => maps:get(<<"page-loads">>, Stats, maps:get(<<"visits">>, Stats, 0)),
        <<"visits">> => maps:get(<<"visits">>, Stats, 0),
        <<"duration-ms">> => maps:get(<<"duration-ms">>, Stats, 0),
        <<"max-duration-ms">> => maps:get(<<"max-duration-ms">>, Stats, 0),
        <<"sessions">> => maps:get(<<"sessions">>, Stats, 0),
        <<"bounces">> => maps:get(<<"bounces">>, Stats, 0),
        <<"demographics">> =>
            #{
                <<"ips">> => bucket_map_to_list(maps:get(<<"by-ip">>, Stats, #{})),
                <<"locations">> => bucket_map_to_list(maps:get(<<"by-location">>, Stats, #{}))
            },
        <<"acquisition">> =>
            #{
                <<"referrers">> => bucket_map_to_list(maps:get(<<"by-referrer">>, Stats, #{})),
                <<"utm-sources">> => bucket_map_to_list(maps:get(<<"by-utm-source">>, Stats, #{})),
                <<"utm-mediums">> => bucket_map_to_list(maps:get(<<"by-utm-medium">>, Stats, #{})),
                <<"utm-campaigns">> => bucket_map_to_list(maps:get(<<"by-utm-campaign">>, Stats, #{}))
            },
        <<"technology">> =>
            #{
                <<"devices">> => bucket_map_to_list(maps:get(<<"by-device">>, Stats, #{})),
                <<"browsers">> => bucket_map_to_list(maps:get(<<"by-browser">>, Stats, #{})),
                <<"operating-systems">> => bucket_map_to_list(maps:get(<<"by-os">>, Stats, #{})),
                <<"languages">> => bucket_map_to_list(maps:get(<<"by-language">>, Stats, #{}))
            },
        <<"events">> =>
            event_bucket_to_list(maps:get(<<"by-event">>, Stats, #{}), maps:get(<<"sessions">>, Stats, 0)),
        <<"actions">> =>
            event_bucket_to_list(maps:get(<<"by-action">>, Stats, #{}), maps:get(<<"sessions">>, Stats, 0))
    }.

demographics_from_days(Daily) ->
    #{
        <<"ips">> => demographic_items_from_days(Daily, <<"by-ip">>, <<"ip">>),
        <<"locations">> => demographic_items_from_days(Daily, <<"by-location">>, <<"location">>)
    }.

demographic_items_from_days(Daily, BucketKey, LabelKey) ->
    Items =
        lists:foldl(
            fun(Day, Acc) ->
                Buckets = map_value(maps:get(BucketKey, Day, #{})),
                maps:fold(
                    fun(Label0, RawStats, ItemAcc) ->
                        Stats = normalize_demographic_stats(RawStats),
                        Label = maps:get(LabelKey, Stats, Label0),
                        Existing = normalize_demographic_stats(maps:get(Label, ItemAcc, #{})),
                        ItemAcc#{
                            Label =>
                                Stats#{
                                    LabelKey => Label,
                                    <<"visits">> =>
                                        int_value(maps:get(<<"visits">>, Existing, 0), 0) +
                                            int_value(maps:get(<<"visits">>, Stats, 0), 0),
                                    <<"duration-ms">> =>
                                        int_value(maps:get(<<"duration-ms">>, Existing, 0), 0) +
                                            int_value(maps:get(<<"duration-ms">>, Stats, 0), 0),
                                    <<"max-duration-ms">> =>
                                        max(
                                            int_value(maps:get(<<"max-duration-ms">>, Existing, 0), 0),
                                            int_value(maps:get(<<"max-duration-ms">>, Stats, 0), 0)
                                        )
                                }
                        }
                    end,
                    Acc,
                    Buckets
                )
            end,
            #{},
            Daily
        ),
    lists:sublist(
        lists:sort(
            fun(A, B) ->
                maps:get(<<"visits">>, A, 0) >= maps:get(<<"visits">>, B, 0)
            end,
            maps:values(Items)
        ),
        50
    ).

%% @doc Realtime count of open tabs, optionally scoped to visits whose current
%% page matches `Route' (exact route or a descendant; `undefined' = no
%% filter). A tab is on exactly one page, so there's no double-counting risk
%% in the filtered count.
active_visits(Key, Route, Opts) ->
    Date = today(),
    Window = active_window_ms(Opts),
    Now = now_ms(),
    %% Ensure the day's visit index is a listable group before listing, so
    %% counts work on stores that require explicit group markers and self-heal
    %% any visits recorded before the marker existed. See ensure_group/2.
    ok = ensure_group(visits_day_path(Key, Date, Opts), Opts),
    case hb_store:list(visits_day_path(Key, Date, Opts), Opts) of
        {ok, VisitIDs} ->
            length(
                [
                    VisitID
                 || VisitID <- VisitIDs,
                    active_visit_matches_route(
                        read_json(visit_path(Key, Date, VisitID, Opts), undefined, Opts),
                        Now,
                        Window,
                        Route
                    )
                ]
            );
        _ ->
            0
    end.

active_visit_matches_route(undefined, _Now, _Window, _Route) ->
    false;
active_visit_matches_route(Visit, Now, Window, Route) ->
    active_visit(Visit, Now, Window) andalso
        page_matches_route(maps:get(<<"page">>, Visit, <<"/">>), Route).

active_visit(undefined, _Now, _Window) ->
    false;
active_visit(Visit, Now, Window) ->
    LastSeen = int_value(maps:get(<<"last-seen">>, Visit, 0), 0),
    (not is_ended(maps:get(<<"ended">>, Visit, false))) andalso
        LastSeen > 0 andalso Now - LastSeen =< Window.

is_ended(true) -> true;
is_ended(<<"true">>) -> true;
is_ended(_) -> false.

daily_default(Date) ->
    #{
        <<"date">> => Date,
        <<"page-loads">> => 0,
        <<"visits">> => 0,
        <<"unique-visitors">> => 0,
        <<"active-users">> => 0,
        <<"new-users">> => 0,
        <<"sessions">> => 0,
        <<"engaged-sessions">> => 0,
        <<"bounces">> => 0,
        <<"duration-ms">> => 0,
        <<"avg-duration-ms">> => 0,
        <<"max-duration-ms">> => 0,
        <<"by-path">> => #{},
        <<"by-ip">> => #{},
        <<"by-location">> => #{},
        <<"by-referrer">> => #{},
        <<"by-utm-source">> => #{},
        <<"by-utm-medium">> => #{},
        <<"by-utm-campaign">> => #{},
        <<"by-first-referrer">> => #{},
        <<"by-first-utm-source">> => #{},
        <<"by-first-utm-medium">> => #{},
        <<"by-first-utm-campaign">> => #{},
        <<"by-session-referrer">> => #{},
        <<"by-session-utm-source">> => #{},
        <<"by-session-utm-medium">> => #{},
        <<"by-session-utm-campaign">> => #{},
        <<"by-device">> => #{},
        <<"by-browser">> => #{},
        <<"by-os">> => #{},
        <<"by-language">> => #{},
        <<"by-entry-page">> => #{},
        <<"by-exit-page">> => #{},
        <<"events">> => 0,
        <<"by-event">> => #{},
        <<"actions">> => 0,
        <<"by-action">> => #{},
        <<"stable-visitors">> => #{},
        <<"stable-visitor-dimensions">> => #{}
    }.

normalize_daily(Date, Daily0) ->
    Daily = map_value(Daily0),
    Visits = int_value(maps:get(<<"visits">>, Daily, 0), 0),
    Duration = int_value(maps:get(<<"duration-ms">>, Daily, 0), 0),
    Daily#{
        <<"date">> => maps:get(<<"date">>, Daily, Date),
        <<"page-loads">> => int_value(maps:get(<<"page-loads">>, Daily, Visits), Visits),
        <<"visits">> => Visits,
        <<"unique-visitors">> => int_value(maps:get(<<"unique-visitors">>, Daily, 0), 0),
        <<"active-users">> => int_value(maps:get(<<"active-users">>, Daily, 0), 0),
        <<"new-users">> => int_value(maps:get(<<"new-users">>, Daily, 0), 0),
        <<"sessions">> => int_value(maps:get(<<"sessions">>, Daily, 0), 0),
        <<"engaged-sessions">> => int_value(maps:get(<<"engaged-sessions">>, Daily, 0), 0),
        <<"bounces">> => int_value(maps:get(<<"bounces">>, Daily, 0), 0),
        <<"duration-ms">> => Duration,
        <<"avg-duration-ms">> => average(Duration, Visits),
        <<"max-duration-ms">> => int_value(maps:get(<<"max-duration-ms">>, Daily, 0), 0),
        <<"by-path">> => map_value(maps:get(<<"by-path">>, Daily, #{})),
        <<"by-ip">> => map_value(maps:get(<<"by-ip">>, Daily, #{})),
        <<"by-location">> => map_value(maps:get(<<"by-location">>, Daily, #{})),
        <<"by-referrer">> => map_value(maps:get(<<"by-referrer">>, Daily, #{})),
        <<"by-utm-source">> => map_value(maps:get(<<"by-utm-source">>, Daily, #{})),
        <<"by-utm-medium">> => map_value(maps:get(<<"by-utm-medium">>, Daily, #{})),
        <<"by-utm-campaign">> => map_value(maps:get(<<"by-utm-campaign">>, Daily, #{})),
        <<"by-first-referrer">> => map_value(maps:get(<<"by-first-referrer">>, Daily, #{})),
        <<"by-first-utm-source">> => map_value(maps:get(<<"by-first-utm-source">>, Daily, #{})),
        <<"by-first-utm-medium">> => map_value(maps:get(<<"by-first-utm-medium">>, Daily, #{})),
        <<"by-first-utm-campaign">> => map_value(maps:get(<<"by-first-utm-campaign">>, Daily, #{})),
        <<"by-session-referrer">> => map_value(maps:get(<<"by-session-referrer">>, Daily, #{})),
        <<"by-session-utm-source">> => map_value(maps:get(<<"by-session-utm-source">>, Daily, #{})),
        <<"by-session-utm-medium">> => map_value(maps:get(<<"by-session-utm-medium">>, Daily, #{})),
        <<"by-session-utm-campaign">> => map_value(maps:get(<<"by-session-utm-campaign">>, Daily, #{})),
        <<"by-device">> => map_value(maps:get(<<"by-device">>, Daily, #{})),
        <<"by-browser">> => map_value(maps:get(<<"by-browser">>, Daily, #{})),
        <<"by-os">> => map_value(maps:get(<<"by-os">>, Daily, #{})),
        <<"by-language">> => map_value(maps:get(<<"by-language">>, Daily, #{})),
        <<"by-entry-page">> => map_value(maps:get(<<"by-entry-page">>, Daily, #{})),
        <<"by-exit-page">> => map_value(maps:get(<<"by-exit-page">>, Daily, #{})),
        <<"events">> => int_value(maps:get(<<"events">>, Daily, 0), 0),
        <<"by-event">> => map_value(maps:get(<<"by-event">>, Daily, #{})),
        <<"actions">> => int_value(maps:get(<<"actions">>, Daily, 0), 0),
        <<"by-action">> => map_value(maps:get(<<"by-action">>, Daily, #{})),
        <<"stable-visitors">> => map_value(maps:get(<<"stable-visitors">>, Daily, #{})),
        <<"stable-visitor-dimensions">> =>
            map_value(maps:get(<<"stable-visitor-dimensions">>, Daily, #{}))
    }.

%% @doc Normalize a `by-path' entry. `sessions'/`bounces' mirror the site-wide
%% counters of the same name, scoped to this exact page (see
%% `apply_page_session_counters/3'); the `by-*' sub-buckets mirror the
%% top-level demographic/technology/acquisition buckets, scoped the same way
%% (see `update_daily/4'). Old records simply lack these keys and get the
%% zero/empty defaults below -- no migration needed.
normalize_page_stats(Raw) ->
    Stats = map_value(Raw),
    #{
        <<"page-loads">> => int_value(maps:get(<<"page-loads">>, Stats, maps:get(<<"visits">>, Stats, 0)), 0),
        <<"visits">> => int_value(maps:get(<<"visits">>, Stats, 0), 0),
        <<"duration-ms">> => int_value(maps:get(<<"duration-ms">>, Stats, 0), 0),
        <<"max-duration-ms">> => int_value(maps:get(<<"max-duration-ms">>, Stats, 0), 0),
        <<"sessions">> => int_value(maps:get(<<"sessions">>, Stats, 0), 0),
        <<"bounces">> => int_value(maps:get(<<"bounces">>, Stats, 0), 0),
        <<"by-ip">> => map_value(maps:get(<<"by-ip">>, Stats, #{})),
        <<"by-location">> => map_value(maps:get(<<"by-location">>, Stats, #{})),
        <<"by-referrer">> => map_value(maps:get(<<"by-referrer">>, Stats, #{})),
        <<"by-utm-source">> => map_value(maps:get(<<"by-utm-source">>, Stats, #{})),
        <<"by-utm-medium">> => map_value(maps:get(<<"by-utm-medium">>, Stats, #{})),
        <<"by-utm-campaign">> => map_value(maps:get(<<"by-utm-campaign">>, Stats, #{})),
        <<"by-device">> => map_value(maps:get(<<"by-device">>, Stats, #{})),
        <<"by-browser">> => map_value(maps:get(<<"by-browser">>, Stats, #{})),
        <<"by-os">> => map_value(maps:get(<<"by-os">>, Stats, #{})),
        <<"by-language">> => map_value(maps:get(<<"by-language">>, Stats, #{})),
        <<"by-event">> => map_value(maps:get(<<"by-event">>, Stats, #{})),
        <<"by-action">> => map_value(maps:get(<<"by-action">>, Stats, #{}))
    }.

normalize_demographic_stats(Raw) ->
    Stats = map_value(Raw),
    Stats#{
        <<"visits">> => int_value(maps:get(<<"visits">>, Stats, 0), 0),
        <<"duration-ms">> => int_value(maps:get(<<"duration-ms">>, Stats, 0), 0),
        <<"max-duration-ms">> => int_value(maps:get(<<"max-duration-ms">>, Stats, 0), 0)
    }.

update_demographic_bucket(Buckets, Label, Extra, VisitIncrement, Delta, NewDuration) ->
    Stats0 =
        normalize_demographic_stats(
            maps:get(
                Label,
                Buckets,
                #{ <<"visits">> => 0, <<"duration-ms">> => 0, <<"max-duration-ms">> => 0 }
            )
        ),
    Stats1 =
        maps:merge(
            Stats0#{
                <<"visits">> => int_value(maps:get(<<"visits">>, Stats0, 0), 0) + VisitIncrement,
                <<"duration-ms">> => int_value(maps:get(<<"duration-ms">>, Stats0, 0), 0) + Delta,
                <<"max-duration-ms">> =>
                    max(
                        int_value(maps:get(<<"max-duration-ms">>, Stats0, 0), 0),
                        NewDuration
                    )
            },
            Extra
        ),
    Buckets#{ Label => Stats1 }.

average(_Total, 0) ->
    0;
average(Total, Count) ->
    Total div Count.

read_site(Key, Opts) ->
    case read_json(site_path(Key, Opts), undefined, Opts) of
        undefined -> configured_site(Key, Opts);
        Site -> Site
    end.

configured_site(Key, Opts) ->
    Sites = hb_opts:get(<<"analytics-sites">>, [], Opts),
    case [Site || Site <- Sites, configured_site_key(Site, Opts) =:= trim_bin(Key)] of
        [Site | _] -> normalize_configured_site(Site, Opts);
        [] -> undefined
    end.

configured_sites_for_owner(Owner, Opts) ->
    Sites = hb_opts:get(<<"analytics-sites">>, [], Opts),
    lists:filtermap(
        fun
            (Site) when is_map(Site) ->
                Normalized = normalize_configured_site(Site, Opts),
                case
                    configured_site_key(Site, Opts) =/= <<>> andalso
                        site_enabled(Normalized, Opts) andalso
                        site_wallet_allowed(Normalized, Owner, Opts)
                of
                    true -> {true, public_site(Normalized, Opts)};
                    false -> false
                end;
            (_) ->
                false
        end,
        Sites
    ).

configured_site_key(Site, Opts) when is_map(Site) ->
    trim_bin(hb_maps:get(<<"key">>, Site, <<>>, Opts));
configured_site_key(_Site, _Opts) ->
    <<>>.

normalize_configured_site(Site, Opts) ->
    #{
        <<"key">> => configured_site_key(Site, Opts),
        <<"owner">> => configured_site_owner(Site, Opts),
        <<"name">> => site_name(Site, Opts),
        <<"origins">> => allowed_origins(Site, Opts),
        <<"users">> => site_users(Site, <<>>, Opts),
        <<"visitor-id-mode">> => visitor_id_mode(Site, Opts),
        <<"engagement-threshold-ms">> => engagement_threshold_ms(Site, Opts),
        <<"engagement-dedupe-window-ms">> => engagement_dedupe_window_ms(Site, Opts),
        <<"node-baseline-writer">> =>
            truthy(hb_maps:get(<<"node-baseline-writer">>, Site, false, Opts)),
        <<"configured">> => true,
        <<"enabled">> => truthy(hb_maps:get(<<"enabled">>, Site, true, Opts))
    }.

configured_site_owner(Site, Opts) ->
    case trim_bin(hb_maps:get(<<"owner">>, Site, <<>>, Opts)) of
        <<>> -> node_wallet_address(Opts);
        Owner -> Owner
    end.

node_wallet_address(Opts) ->
    case hb_opts:get(priv_wallet, undefined, Opts) of
        undefined -> <<>>;
        Wallet ->
            try hb_util:human_id(ar_wallet:to_address(Wallet))
            catch
                _:_ -> <<>>
            end
    end.

%% A site is enabled unless explicitly disabled (soft-deleted). Legacy records
%% without the field are treated as enabled.
site_enabled(Site, Opts) ->
    truthy(hb_maps:get(<<"enabled">>, Site, true, Opts)).

%% Like read_site/2, but treats a soft-deleted (disabled) site as absent so the
%% public session/event endpoints stop collecting for it.
read_active_site(Key, Opts) ->
    case read_site(Key, Opts) of
        undefined -> undefined;
        Site ->
            case site_enabled(Site, Opts) of
                true -> Site;
                false -> undefined
            end
    end.

read_json(Path, Default, Opts) ->
    case hb_store:read(Path, Opts) of
        {ok, Body} when is_binary(Body) ->
            try hb_json:decode(Body) of
                Decoded -> Decoded
            catch
                _:_ -> Default
            end;
        _ ->
            Default
    end.

write_json(Path, Value, Opts) ->
    hb_store:write(#{ Path => hb_json:encode(Value) }, Opts).

write_json_entries(Entries, Opts) ->
    hb_store:write(maps:map(fun(_Path, Value) -> hb_json:encode(Value) end, Entries), Opts).

%% @doc Ensure a listable group marker exists at `Path'. Some stores (notably
%% `hb_store_lmdb', the default primary store for a running node) require an
%% explicit group entry before `hb_store:list/2' will return the children
%% written beneath a path; others (the volatile and filesystem stores) create
%% it implicitly on write. We create it explicitly wherever the device intends
%% to list a directory (owner -> sites, and per-day visits) so listing behaves
%% identically across every store backend.
ensure_group(Path, Opts) ->
    case hb_store:group(Path, Opts) of
        ok -> ok;
        {ok, _} -> ok;
        Other -> Other
    end.

site_path(Key, Opts) ->
    store_path([<<"sites">>, path_component(Key)], Opts).

owner_path(Owner, Opts) ->
    store_path([<<"owners">>, path_component(Owner)], Opts).

owner_site_path(Owner, Key, Opts) ->
    store_path([<<"owners">>, path_component(Owner), path_component(Key)], Opts).

daily_path(Key, Date, Opts) ->
    store_path([<<"daily">>, path_component(Key), path_component(Date)], Opts).

visits_day_path(Key, Date, Opts) ->
    store_path([<<"visits">>, path_component(Key), path_component(Date)], Opts).

visit_path(Key, Date, VisitID, Opts) ->
    store_path([<<"visits">>, path_component(Key), path_component(Date), path_component(VisitID)], Opts).

nonce_path(Owner, Nonce, Opts) ->
    store_path([<<"nonces">>, path_component(Owner), path_component(Nonce)], Opts).

subject_path(Key, SubjectID, Opts) ->
    store_path([<<"subjects">>, path_component(Key), path_component(SubjectID)], Opts).

subjects_path(Key, Opts) ->
    store_path([<<"subjects">>, path_component(Key)], Opts).

subject_child_path(Key, SubjectKey, Opts) ->
    store_path([<<"subjects">>, path_component(Key), SubjectKey], Opts).

engagement_path(Key, SubjectID, InteractionID, Opts) ->
    store_path(
        [
            <<"engagements">>,
            path_component(Key),
            path_component(SubjectID),
            path_component(InteractionID)
        ],
        Opts
    ).

store_path(Parts, Opts) ->
    [store_root(Opts) | Parts].

store_root(Opts) ->
    path_component(hb_opts:get(<<"analytics-root">>, <<"analytics">>, Opts)).

static(Name, _Opts) ->
    Filename =
        filename:join(
            hb_device_archive:implementation_dir(?MODULE),
            hb_util:list(Name)
        ),
    case file:read_file(Filename) of
        {ok, Body} ->
            {ok,
                #{
                    <<"body">> => Body,
                    <<"content-type">> => content_type(Name)
                }
            };
        {error, _} ->
            {error, not_found}
    end.

content_type(<<"session.js">>) -> <<"text/javascript">>;
content_type(_) -> <<"application/octet-stream">>.

with_common_headers({ok, Msg}) ->
    {ok,
        Msg#{
            <<"cache-control">> => ?NO_CACHE,
            <<"access-control-allow-origin">> => <<"*">>,
            <<"access-control-expose-headers">> => <<"*">>
        }};
with_common_headers(Other) ->
    Other.

json_ok(Body) ->
    with_common_headers(
        {ok,
            #{
                <<"status">> => 200,
                <<"content-type">> => <<"application/json">>,
                <<"body">> => hb_json:encode(Body)
            }}
    ).

json_error(Status, Reason) ->
    with_common_headers(
        {ok,
            #{
                <<"status">> => Status,
                <<"content-type">> => <<"application/json">>,
                <<"body">> =>
                    hb_json:encode(
                        #{
                            <<"ok">> => false,
                            <<"error">> => Reason,
                            <<"status">> => Status
                        }
                    )
            }}
    ).

js_error(Status, Reason) ->
    with_common_headers(
        {ok,
            #{
                <<"status">> => Status,
                <<"content-type">> => <<"text/javascript">>,
                <<"body">> => <<"console.error(", (js_string_literal(Reason))/binary, ");">>
            }}
    ).

required(Key, Req, Opts) ->
    case trim_bin(hb_maps:get(Key, Req, <<>>, Opts)) of
        <<>> -> {error, <<"Missing required field: ", Key/binary>>};
        Value -> {ok, Value}
    end.

visit_id(Req, Opts) ->
    case trim_bin(hb_maps:get(<<"visit">>, Req, <<>>, Opts)) of
        <<>> -> random_token(16);
        Visit -> path_component(Visit)
    end.

page_path(Req, Opts) ->
    Raw =
        hb_ao:get_first(
            [
                {Req, <<"page">>},
                {Req, <<"page-path">>},
                {Req, <<"tracked-path">>}
            ],
            <<"/">>,
            Opts
        ),
    sanitize_page(Raw).

sanitize_page(Value) ->
    Trimmed0 = trim_bin(Value),
    Trimmed1 = hash_route_path(Trimmed0),
    Trimmed2 = strip_url_tail(strip_url_tail(Trimmed1, <<"?">>), <<"#">>),
    Trimmed3 =
        case Trimmed2 of
            <<>> -> <<"/">>;
            <<"/", _/binary>> -> Trimmed2;
            _ -> <<"/", Trimmed2/binary>>
        end,
    limit_binary(Trimmed3, 256).

%% @doc Normalize a page/route for route-filter matching: lowercase, a single
%% leading slash, no trailing slash. Mirrors the frontend's `normalizeRoute'
%% (frontend/src/views/Dashboard/analytics.ts) so a route typed in the
%% dashboard matches the same way server-side (used for the realtime
%% Active Visitors count) and client-side (used for everything else).
normalize_route(undefined) ->
    <<>>;
normalize_route(Value) when is_binary(Value) ->
    case trim_bin(Value) of
        <<>> ->
            <<>>;
        Trimmed ->
            Lower = to_lower_bin(Trimmed),
            WithSlash =
                case Lower of
                    <<"/", _/binary>> -> Lower;
                    _ -> <<"/", Lower/binary>>
                end,
            case strip_trailing_slashes(WithSlash) of
                <<>> -> <<"/">>;
                Stripped -> Stripped
            end
    end;
normalize_route(_) ->
    <<>>.

strip_trailing_slashes(<<"/">>) ->
    <<"/">>;
strip_trailing_slashes(Bin) ->
    Size = byte_size(Bin),
    case Size > 0 andalso binary:at(Bin, Size - 1) =:= $/ of
        true -> strip_trailing_slashes(binary:part(Bin, 0, Size - 1));
        false -> Bin
    end.

%% @doc A page belongs to a route filter when it is that exact route or a
%% descendant of it: "/blog" matches "/blog" and "/blog/post" but not
%% "/blogger". An empty/unset route matches everything (no filter). Mirrors
%% the frontend's `pageMatchesRoute'.
page_matches_route(Page, Route) ->
    case normalize_route(Route) of
        <<>> ->
            true;
        NormalizedRoute ->
            NormalizedPage = normalize_route(Page),
            RouteLen = byte_size(NormalizedRoute),
            case NormalizedPage of
                NormalizedRoute -> true;
                <<NormalizedRoute:RouteLen/binary, "/", _/binary>> -> true;
                _ -> false
            end
    end.

hash_route_path(Bin) ->
    case binary:match(Bin, <<"#/">>) of
        {Start, _Len} ->
            binary:part(Bin, Start + 1, byte_size(Bin) - Start - 1);
        nomatch ->
            case binary:match(Bin, <<"#!">>) of
                {Start, _Len} ->
                    HashPath0 = binary:part(Bin, Start + 2, byte_size(Bin) - Start - 2),
                    case HashPath0 of
                        <<"/", _/binary>> -> HashPath0;
                        _ -> <<"/", HashPath0/binary>>
                    end;
                nomatch ->
                    Bin
            end
    end.

demographics(Req, Opts) ->
    Location = location_record(Req, Opts),
    #{
        <<"ip">> => client_ip(Req, Opts),
        <<"location">> => Location#{ <<"location">> => location_label(Location, Opts) }
    }.

client_ip(Req, Opts) ->
    Raw =
        hb_ao:get_first(
            [
                {Req, <<"cf-connecting-ip">>},
                {Req, <<"true-client-ip">>},
                {Req, <<"x-real-ip">>},
                {Req, <<"x-forwarded-for">>},
                {Req, <<"forwarded">>},
                {Req, <<"remote-addr">>},
                {Req, <<"remote_addr">>},
                {Req, <<"peer">>}
            ],
            <<>>,
            Opts
        ),
    case sanitize_ip(Raw) of
        <<"unknown">> -> connection_ip(Req, Opts);
        IP -> IP
    end.

%% @doc When no proxy IP header is present (e.g. the device is reached directly,
%% with no CDN/reverse proxy injecting `x-forwarded-for'/`cf-connecting-ip'),
%% fall back to the real connection IP. HyperBEAM resolves it from the
%% `x-real-ip' header or the raw socket peer and stashes it in the message's
%% private section under `ip'. Without this, every direct/same-origin visitor
%% hashes to the same "unknown" address and collapses into a single visitor.
connection_ip(Req, Opts) ->
    sanitize_ip(hb_private:get(<<"ip">>, Req, <<>>, Opts)).

sanitize_ip(Raw) ->
    First = first_forwarded_ip(trim_bin(Raw)),
    Clean0 =
        case First of
            <<"for=", Rest/binary>> -> Rest;
            _ -> First
        end,
    Clean1 = binary:replace(Clean0, <<"\"">>, <<>>, [global]),
    Clean2 = binary:replace(Clean1, <<"[">>, <<>>, [global]),
    Clean3 = binary:replace(Clean2, <<"]">>, <<>>, [global]),
    case trim_bin(Clean3) of
        <<>> -> <<"unknown">>;
        IP -> limit_binary(IP, 128)
    end.

first_forwarded_ip(Bin) ->
    case binary:split(Bin, <<",">>) of
        [Head, _Tail] -> first_forwarded_pair(Head);
        [Head] -> first_forwarded_pair(Head)
    end.

first_forwarded_pair(Bin) ->
    case binary:split(trim_bin(Bin), <<";">>) of
        [Head, _Tail] -> trim_bin(Head);
        [Head] -> trim_bin(Head)
    end.

location_record(Req, Opts) ->
    #{
        <<"country">> => country_from_request(Req, Opts),
        <<"region">> =>
            location_value(
                hb_ao:get_first(
                    [
                        {Req, <<"x-vercel-ip-country-region">>},
                        {Req, <<"cf-region">>},
                        {Req, <<"cf-ipregion">>},
                        {Req, <<"x-region">>},
                        {Req, <<"x-forwarded-region">>},
                        {Req, <<"x-appengine-region">>}
                    ],
                    <<>>,
                    Opts
                )
            ),
        <<"city">> =>
            location_value(
                hb_ao:get_first(
                    [
                        {Req, <<"x-vercel-ip-city">>},
                        {Req, <<"cf-ipcity">>},
                        {Req, <<"x-city">>},
                        {Req, <<"x-forwarded-city">>},
                        {Req, <<"x-appengine-city">>}
                    ],
                    <<>>,
                    Opts
                )
            )
    }.

location_value(Value) ->
    Clean = trim_bin(Value),
    case string:lowercase(binary_to_list(Clean)) of
        "" -> <<>>;
        "unknown" -> <<>>;
        "xx" -> <<>>;
        "zz" -> <<>>;
        _ -> limit_binary(Clean, 96)
    end.

%% Country for a request: a CDN/edge geo header when present (cf-ipcountry et al.),
%% otherwise a server-side GeoIP lookup on the visitor IP. The fallback is what
%% makes demographics work behind a plain reverse proxy that injects no geo header.
country_from_request(Req, Opts) ->
    case
        location_value(
            hb_ao:get_first(
                [
                    {Req, <<"x-vercel-ip-country">>},
                    {Req, <<"cf-ipcountry">>},
                    {Req, <<"cloudfront-viewer-country">>},
                    {Req, <<"x-country-code">>},
                    {Req, <<"x-forwarded-country">>},
                    {Req, <<"x-appengine-country">>}
                ],
                <<>>,
                Opts
            )
        )
    of
        <<>> -> geo_country(client_ip(Req, Opts), Opts);
        Country -> Country
    end.

%% Map a visitor IP to an ISO country code via the configured GeoIP database.
%% Returns <<>> (Unknown) for a private/unknown IP, a missing/still-loading
%% database, or any lookup error, so it degrades to the prior header-only
%% behaviour when geolocation is not set up.
geo_country(<<"unknown">>, _Opts) ->
    <<>>;
geo_country(IP, Opts) ->
    case geo_lookup(IP, Opts) of
        #{ <<"country">> := #{ <<"iso_code">> := Code } } when is_binary(Code) ->
            location_value(Code);
        _ ->
            <<>>
    end.

geo_lookup(IP, Opts) ->
    case ensure_geoip(Opts) of
        ready ->
            try locus:lookup(?GEOIP_LOADER, binary_to_list(IP)) of
                {ok, Record} when is_map(Record) -> Record;
                _ -> undefined
            catch
                _:_ -> undefined
            end;
        _ ->
            undefined
    end.

%% Start the GeoIP MMDB loader once and cache the outcome in persistent_term.
%% The database is taken from the ANALYTICS_GEOIP_DB env var: an absolute path to
%% a `.mmdb' file, or an http(s) URL to one (e.g. MaxMind GeoLite2-Country, or
%% DB-IP's free dbip-country-lite). Unset => geolocation disabled (Unknown).
ensure_geoip(_Opts) ->
    case persistent_term:get(?GEOIP_STATE_KEY, undefined) of
        undefined -> init_geoip();
        State -> State
    end.

init_geoip() ->
    State =
        case geoip_db_source() of
            undefined ->
                disabled;
            Source ->
                _ = application:ensure_all_started(locus),
                case locus:start_loader(?GEOIP_LOADER, Source) of
                    ok -> ready;
                    {error, already_started} -> ready;
                    {error, _} -> disabled
                end
        end,
    persistent_term:put(?GEOIP_STATE_KEY, State),
    State.

geoip_db_source() ->
    case os:getenv("ANALYTICS_GEOIP_DB") of
        false -> undefined;
        "" -> undefined;
        Source -> Source
    end.

demographic_ip(Demographics, Opts) ->
    case hb_maps:get(<<"ip">>, Demographics, <<"unknown">>, Opts) of
        <<>> -> <<"unknown">>;
        IP -> IP
    end.

demographic_location(Demographics, Opts) ->
    map_value(hb_maps:get(<<"location">>, Demographics, #{}, Opts)).

location_label(Location, _Opts) ->
    Parts =
        [
            Value
         || Value <- [
                maps:get(<<"city">>, Location, <<>>),
                maps:get(<<"region">>, Location, <<>>),
                maps:get(<<"country">>, Location, <<>>)
            ],
            Value =/= <<>>
        ],
    case Parts of
        [] -> <<"Unknown">>;
        _ -> join_binary(Parts, <<", ">>)
    end.

join_binary([], _Separator) ->
    <<>>;
join_binary([Head], _Separator) ->
    Head;
join_binary([Head | Tail], Separator) ->
    lists:foldl(fun(Item, Acc) -> <<Acc/binary, Separator/binary, Item/binary>> end, Head, Tail).

event_type(Req, Opts) ->
    case trim_bin(hb_maps:get(<<"event">>, Req, <<"heartbeat">>, Opts)) of
        <<"start">> -> <<"start">>;
        <<"end">> -> <<"end">>;
        <<"heartbeat">> -> <<"heartbeat">>;
        _ -> <<"heartbeat">>
    end.

duration_ms(Req, Opts) ->
    clamp(
        int_value(hb_maps:get(<<"duration">>, Req, hb_maps:get(<<"duration-ms">>, Req, 0, Opts), Opts), 0),
        0,
        ?MAX_DURATION_MS
    ).

engagement_threshold_ms(Req, Opts) ->
    engagement_threshold_ms(Req, default_engagement_threshold_ms(Opts), Opts).

engagement_threshold_ms(Req, Default, Opts) ->
    clamp(
        int_value(hb_maps:get(<<"engagement-threshold-ms">>, Req, Default, Opts), Default),
        1_000,
        ?MAX_DURATION_MS
    ).

default_engagement_threshold_ms(Opts) ->
    clamp(
        int_value(
            hb_opts:get(
                <<"analytics-engagement-threshold-ms">>,
                ?DEFAULT_ENGAGEMENT_THRESHOLD_MS,
                Opts
            ),
            ?DEFAULT_ENGAGEMENT_THRESHOLD_MS
        ),
        1_000,
        ?MAX_DURATION_MS
    ).

site_engagement_threshold_ms(Site, Opts) ->
    clamp(
        int_value(
            hb_maps:get(
                <<"engagement-threshold-ms">>,
                Site,
                default_engagement_threshold_ms(Opts),
                Opts
            ),
            default_engagement_threshold_ms(Opts)
        ),
        1_000,
        ?MAX_DURATION_MS
    ).

engagement_dedupe_window_ms(Req, Opts) ->
    engagement_dedupe_window_ms(Req, default_engagement_dedupe_window_ms(Opts), Opts).

engagement_dedupe_window_ms(Req, Default, Opts) ->
    clamp(
        int_value(hb_maps:get(<<"engagement-dedupe-window-ms">>, Req, Default, Opts), Default),
        60_000,
        2_592_000_000
    ).

default_engagement_dedupe_window_ms(Opts) ->
    clamp(
        int_value(
            hb_opts:get(
                <<"analytics-engagement-dedupe-window-ms">>,
                ?DEFAULT_ENGAGEMENT_DEDUPE_WINDOW_MS,
                Opts
            ),
            ?DEFAULT_ENGAGEMENT_DEDUPE_WINDOW_MS
        ),
        60_000,
        2_592_000_000
    ).

site_engagement_dedupe_window_ms(Site, Opts) ->
    engagement_dedupe_window_ms(Site, default_engagement_dedupe_window_ms(Opts), Opts).

engagement_clock_skew_ms(Opts) ->
    clamp(
        int_value(
            hb_opts:get(
                <<"analytics-engagement-clock-skew-ms">>,
                ?DEFAULT_ENGAGEMENT_CLOCK_SKEW_MS,
                Opts
            ),
            ?DEFAULT_ENGAGEMENT_CLOCK_SKEW_MS
        ),
        0,
        300_000
    ).

days(Req, Opts) ->
    clamp(
        int_value(hb_maps:get(<<"days">>, Req, ?DEFAULT_DAYS, Opts), ?DEFAULT_DAYS),
        1,
        ?MAX_DAYS
    ).

bounded_positive_int(Value, Default, Maximum) ->
    clamp(int_value(Value, Default), 1, Maximum).

drop_n(Count, List) when Count =< 0 ->
    List;
drop_n(_Count, []) ->
    [];
drop_n(Count, [_ | Rest]) ->
    drop_n(Count - 1, Rest).

nonce_ttl_ms(Opts) ->
    clamp(
        int_value(hb_opts:get(<<"analytics-nonce-ttl-ms">>, ?DEFAULT_NONCE_TTL_MS, Opts), ?DEFAULT_NONCE_TTL_MS),
        1_000,
        3_600_000
    ).

active_window_ms(Opts) ->
    clamp(
        int_value(
            hb_opts:get(<<"analytics-active-window-ms">>, ?DEFAULT_ACTIVE_WINDOW_MS, Opts),
            ?DEFAULT_ACTIVE_WINDOW_MS
        ),
        1_000,
        3_600_000
    ).

today() ->
    date_string(universal_date()).

last_dates(Days) ->
    {Y, M, D} = universal_date(),
    Today = calendar:date_to_gregorian_days(Y, M, D),
    lists:reverse(
        [
            date_string(calendar:gregorian_days_to_date(Today - Offset))
         || Offset <- lists:seq(0, Days - 1)
        ]
    ).

universal_date() ->
    {Date, _Time} = calendar:system_time_to_universal_time(os:system_time(second), second),
    Date.

date_string({Y, M, D}) ->
    iolist_to_binary(
        io_lib:format(
            "~4..0B-~2..0B-~2..0B",
            [Y, M, D]
        )
    ).

now_ms() ->
    erlang:system_time(millisecond).

random_token(Bytes) ->
    hb_util:encode(crypto:strong_rand_bytes(Bytes)).

path_component(Value) ->
    Bin = trim_bin(Value),
    case re:run(Bin, <<"^[A-Za-z0-9_-]+$">>) of
        {match, _} -> Bin;
        _ -> hb_util:human_id(crypto:hash(sha256, Bin))
    end.

trim_bin(Value) when is_binary(Value) ->
    list_to_binary(string:trim(binary_to_list(Value)));
trim_bin(Value) when is_atom(Value) ->
    atom_to_binary(Value, utf8);
trim_bin(Value) when is_integer(Value) ->
    integer_to_binary(Value);
trim_bin(Value) when is_list(Value) ->
    list_to_binary(string:trim(Value));
trim_bin(Value) ->
    hb_util:bin(Value).

strip_trailing_slash(<<>>) ->
    <<>>;
strip_trailing_slash(Bin) ->
    Size = byte_size(Bin),
    case binary:last(Bin) of
        $/ -> binary:part(Bin, 0, Size - 1);
        _ -> Bin
    end.

strip_url_tail(Bin, Separator) ->
    case binary:split(Bin, Separator) of
        [Head, _Tail] -> Head;
        [Head] -> Head
    end.

limit_binary(Bin, Max) when byte_size(Bin) =< Max ->
    Bin;
limit_binary(Bin, Max) ->
    binary:part(Bin, 0, Max).

int_value(Value, _Default) when is_integer(Value) ->
    Value;
int_value(Value, Default) when is_binary(Value) ->
    try binary_to_integer(Value) of
        Int -> Int
    catch
        _:_ -> Default
    end;
int_value(Value, Default) when is_list(Value) ->
    int_value(list_to_binary(Value), Default);
int_value(_, Default) ->
    Default.

map_value(Value) when is_map(Value) ->
    Value;
map_value(_) ->
    #{}.

clamp(Value, Min, _Max) when Value < Min ->
    Min;
clamp(Value, _Min, Max) when Value > Max ->
    Max;
clamp(Value, _Min, _Max) ->
    Value.

truthy(true) -> true;
truthy(<<"true">>) -> true;
truthy(<<"1">>) -> true;
truthy(1) -> true;
truthy(_) -> false.

js_string_escape(Bin) ->
    Escaped0 = binary:replace(Bin, <<"\\">>, <<"\\\\">>, [global]),
    Escaped1 = binary:replace(Escaped0, <<"\"">>, <<"\\\"">>, [global]),
    Escaped1.

js_string_literal(Bin) ->
    Escaped = js_string_escape(trim_bin(Bin)),
    <<"\"", Escaped/binary, "\"">>.

%% =========================================================================
%% Acquisition + technology dimensions
%% =========================================================================

%% @doc Build the per-ping acquisition/technology dimensions. The User-Agent is
%% read from the HTTP header (sent automatically by the browser) and parsed into
%% coarse categories server-side; the raw UA is never stored, matching the
%% device's privacy model.
dimensions(Site, Req, Opts) ->
    UA = trim_bin(hb_maps:get(<<"user-agent">>, Req, <<>>, Opts)),
    #{
        <<"referrer">> => referrer_source(Site, Req, Opts),
        <<"utm-source">> => utm_param(Req, <<"utm_source">>, Opts),
        <<"utm-medium">> => utm_param(Req, <<"utm_medium">>, Opts),
        <<"utm-campaign">> => utm_param(Req, <<"utm_campaign">>, Opts),
        <<"device">> => ua_device(UA),
        <<"browser">> => ua_browser(UA),
        <<"os">> => ua_os(UA),
        <<"language">> => language_value(Req, Opts)
    }.

%% @doc Reduce a referrer URL to its bare source host (e.g. "google.com"),
%% returning "Direct" when absent. Only the host is kept, never the full URL.
%% A referrer pointing at the site's own host is an internal navigation, not an
%% acquisition source, so it is also reported as "Direct".
referrer_source(Site, Req, Opts) ->
    Raw = trim_bin(hb_ao:get_first([{Req, <<"referrer">>}, {Req, <<"referer">>}], <<>>, Opts)),
    case Raw of
        <<>> -> <<"Direct">>;
        _ ->
            case to_lower_bin(referrer_host(Raw)) of
                <<>> -> <<"Direct">>;
                Host ->
                    case lists:member(Host, self_hosts(Site, Req, Opts)) of
                        true -> <<"Direct">>;
                        false -> limit_binary(Host, 96)
                    end
            end
    end.

%% @doc Hosts that count as "the site itself" for same-origin referrer
%% filtering: the page origin reported on the ping plus the site's registered
%% origins, each reduced to a bare lower-cased host (www-stripped). The wildcard
%% origin is ignored — it matches no concrete referrer host.
self_hosts(Site, Req, Opts) ->
    Origins = hb_maps:get(<<"origins">>, Site, [], Opts),
    ReqOrigin = hb_maps:get(<<"origin">>, Req, <<>>, Opts),
    Hosts =
        [
            to_lower_bin(referrer_host(trim_bin(Origin)))
         || Origin <- [ReqOrigin | Origins],
            Origin =/= <<"*">>,
            trim_bin(Origin) =/= <<>>
        ],
    [Host || Host <- Hosts, Host =/= <<>>].

referrer_host(Url) ->
    NoScheme =
        case binary:split(Url, <<"://">>) of
            [_, Rest] -> Rest;
            [Only] -> Only
        end,
    Host0 = strip_url_tail(strip_url_tail(strip_url_tail(NoScheme, <<"/">>), <<"?">>), <<"#">>),
    Host1 = strip_url_tail(Host0, <<":">>),
    case Host1 of
        <<"www.", Rest2/binary>> -> Rest2;
        _ -> Host1
    end.

utm_param(Req, Field, Opts) ->
    case limit_binary(trim_bin(hb_maps:get(Field, Req, <<>>, Opts)), 96) of
        <<>> -> <<>>;
        Value -> Value
    end.

%% @doc Primary language subtag (e.g. "en" from "en-US,en;q=0.9").
language_value(Req, Opts) ->
    Raw = trim_bin(hb_ao:get_first([{Req, <<"language">>}, {Req, <<"accept-language">>}], <<>>, Opts)),
    Primary = strip_url_tail(strip_url_tail(strip_url_tail(Raw, <<",">>), <<";">>), <<"-">>),
    case to_lower_bin(Primary) of
        <<>> -> <<"Unknown">>;
        Lang -> limit_binary(Lang, 35)
    end.

ua_contains(UA, Needle) ->
    binary:match(UA, Needle) =/= nomatch.

ua_device(UA0) ->
    UA = to_lower_bin(UA0),
    case UA of
        <<>> -> <<"Unknown">>;
        _ ->
            IsTablet =
                ua_contains(UA, <<"tablet">>) orelse ua_contains(UA, <<"ipad">>) orelse
                    (ua_contains(UA, <<"android">>) andalso not ua_contains(UA, <<"mobile">>)),
            IsMobile =
                ua_contains(UA, <<"mobi">>) orelse ua_contains(UA, <<"iphone">>) orelse
                    ua_contains(UA, <<"ipod">>),
            if
                IsTablet -> <<"Tablet">>;
                IsMobile -> <<"Mobile">>;
                true -> <<"Desktop">>
            end
    end.

ua_browser(UA0) ->
    case to_lower_bin(UA0) of
        <<>> -> <<"Unknown">>;
        UA ->
            ua_first_match(
                UA,
                [
                    {<<"edg">>, <<"Edge">>},
                    {<<"opr">>, <<"Opera">>},
                    {<<"opera">>, <<"Opera">>},
                    {<<"samsungbrowser">>, <<"Samsung Internet">>},
                    {<<"crios">>, <<"Chrome">>},
                    {<<"chrome">>, <<"Chrome">>},
                    {<<"fxios">>, <<"Firefox">>},
                    {<<"firefox">>, <<"Firefox">>},
                    {<<"safari">>, <<"Safari">>}
                ],
                <<"Other">>
            )
    end.

ua_os(UA0) ->
    case to_lower_bin(UA0) of
        <<>> -> <<"Unknown">>;
        UA ->
            ua_first_match(
                UA,
                [
                    {<<"windows">>, <<"Windows">>},
                    {<<"iphone">>, <<"iOS">>},
                    {<<"ipad">>, <<"iOS">>},
                    {<<"ipod">>, <<"iOS">>},
                    {<<"mac os">>, <<"macOS">>},
                    {<<"macos">>, <<"macOS">>},
                    {<<"android">>, <<"Android">>},
                    {<<"cros">>, <<"ChromeOS">>},
                    {<<"linux">>, <<"Linux">>}
                ],
                <<"Other">>
            )
    end.

ua_first_match(_UA, [], Default) ->
    Default;
ua_first_match(UA, [{Needle, Label} | Rest], Default) ->
    case ua_contains(UA, Needle) of
        true -> Label;
        false -> ua_first_match(UA, Rest, Default)
    end.

to_lower_bin(Bin) ->
    list_to_binary(string:lowercase(binary_to_list(trim_bin(Bin)))).

%% @doc Fold the acquisition/technology dimensions into their daily buckets,
%% exactly like by-ip/by-location. Empty values (e.g. an absent UTM tag) are
%% skipped so they don't create noise buckets.
fold_dimension_buckets(Daily, Dimensions, VisitIncrement, Delta, NewDuration) ->
    Specs =
        [
            {<<"by-referrer">>, <<"referrer">>, maps:get(<<"referrer">>, Dimensions, <<"Direct">>)},
            {<<"by-device">>, <<"device">>, maps:get(<<"device">>, Dimensions, <<"Unknown">>)},
            {<<"by-browser">>, <<"browser">>, maps:get(<<"browser">>, Dimensions, <<"Unknown">>)},
            {<<"by-os">>, <<"os">>, maps:get(<<"os">>, Dimensions, <<"Unknown">>)},
            {<<"by-language">>, <<"language">>, maps:get(<<"language">>, Dimensions, <<"Unknown">>)},
            {<<"by-utm-source">>, <<"utm-source">>, maps:get(<<"utm-source">>, Dimensions, <<>>)},
            {<<"by-utm-medium">>, <<"utm-medium">>, maps:get(<<"utm-medium">>, Dimensions, <<>>)},
            {<<"by-utm-campaign">>, <<"utm-campaign">>, maps:get(<<"utm-campaign">>, Dimensions, <<>>)}
        ],
    lists:foldl(
        fun
            ({_BucketKey, _LabelField, <<>>}, Acc) ->
                Acc;
            ({BucketKey, LabelField, Label}, Acc) ->
                Bucket0 = map_value(maps:get(BucketKey, Acc, #{})),
                Bucket1 =
                    update_demographic_bucket(
                        Bucket0,
                        Label,
                        #{ LabelField => Label },
                        VisitIncrement,
                        Delta,
                        NewDuration
                    ),
                Acc#{ BucketKey => Bucket1 }
        end,
        Daily,
        Specs
    ).

acquisition_dimensions(Dimensions) ->
    maps:with(
        [<<"referrer">>, <<"utm-source">>, <<"utm-medium">>, <<"utm-campaign">>],
        map_value(Dimensions)
    ).

%% First-touch attribution is written once for an opted-in persistent visitor.
%% Session-touch attribution is written once per session and receives duration
%% and engagement deltas as that session advances. Labels remain generic web
%% dimensions; channel grouping is a report-consumer concern.
apply_acquisition_attribution(Daily, Session, PersistentVisitor, Delta) ->
    Daily1 =
        case PersistentVisitor of
            #{ <<"new-user">> := true, <<"first-acquisition">> := FirstAcquisition } ->
                fold_attribution_buckets(
                    Daily,
                    <<"by-first">>,
                    FirstAcquisition,
                    #{ <<"users">> => 1, <<"new-users">> => 1 }
                );
            _ ->
                Daily
        end,
    Acquisition = map_value(maps:get(<<"acquisition">>, Session, #{})),
    case map_size(Acquisition) of
        0 ->
            Daily1;
        _ ->
            fold_attribution_buckets(
                Daily1,
                <<"by-session">>,
                Acquisition,
                #{
                    <<"sessions">> => bool_to_int(maps:get(<<"new-session">>, Session, false)),
                    <<"engaged-sessions">> =>
                        bool_to_int(maps:get(<<"new-engaged-session">>, Session, false)),
                    <<"duration-ms">> => Delta
                }
            )
    end.

fold_attribution_buckets(Daily, Prefix, Dimensions, Increments) ->
    Specs =
        [
            {<<Prefix/binary, "-referrer">>, <<"referrer">>},
            {<<Prefix/binary, "-utm-source">>, <<"utm-source">>},
            {<<Prefix/binary, "-utm-medium">>, <<"utm-medium">>},
            {<<Prefix/binary, "-utm-campaign">>, <<"utm-campaign">>}
        ],
    lists:foldl(
        fun({BucketKey, Field}, Acc) ->
            case maps:get(Field, Dimensions, <<>>) of
                <<>> ->
                    Acc;
                Label ->
                    Bucket0 = map_value(maps:get(BucketKey, Acc, #{})),
                    Stats0 = map_value(maps:get(Label, Bucket0, #{})),
                    Stats1 =
                        maps:fold(
                            fun(Counter, Increment, StatsAcc) ->
                                StatsAcc#{
                                    Counter =>
                                        int_value(maps:get(Counter, StatsAcc, 0), 0) +
                                            int_value(Increment, 0)
                                }
                            end,
                            Stats0#{ Field => Label },
                            Increments
                        ),
                    Acc#{ BucketKey => Bucket0#{ Label => Stats1 } }
            end
        end,
        Daily,
        Specs
    ).

%% @doc Apply unique-visitor, session and bounce counters plus landing/exit page
%% counts to the daily record. `bounces' tracks single-page sessions: +1 when a
%% session opens, -1 when its second pageview arrives.
apply_session_counters(Daily, Session, NewVisitor, Page) ->
    UniqueInc = bool_to_int(NewVisitor),
    NewSession = maps:get(<<"new-session">>, Session, false),
    Unbounced = maps:get(<<"unbounced">>, Session, false),
    NewEngagedSession = maps:get(<<"new-engaged-session">>, Session, false),
    BounceInc = bool_to_int(NewSession) - bool_to_int(Unbounced),
    Daily1 =
        Daily#{
            <<"unique-visitors">> => int_value(maps:get(<<"unique-visitors">>, Daily, 0), 0) + UniqueInc,
            <<"sessions">> => int_value(maps:get(<<"sessions">>, Daily, 0), 0) + bool_to_int(NewSession),
            <<"engaged-sessions">> =>
                int_value(maps:get(<<"engaged-sessions">>, Daily, 0), 0) +
                    bool_to_int(NewEngagedSession),
            <<"bounces">> => max(0, int_value(maps:get(<<"bounces">>, Daily, 0), 0) + BounceInc)
        },
    Daily2 = apply_page_session_counters(Daily1, Session, Page),
    apply_entry_exit(Daily2, Session, NewSession).

%% @doc Mirror the sessions/bounces increments above onto the specific page(s)
%% involved, so a route filter can sum `by-path[Page].sessions'/`.bounces' the
%% same way it already sums `.visits'/`.duration-ms'.
%% - `sessions' is attributed to whichever page just became new to this
%%   session: the whole session on open (`new-session'), or a newly-visited
%%   page within an ongoing one (`page-new-to-session', set by
%%   `touch_session/6'/`open_session/4').
%% - `bounces' is always attributed to the session's `entry-page' -- the only
%%   page a bounce (a single-page-total session) could possibly be about --
%%   which may differ from the current ping's `Page' on the ping that ends a
%%   bounce (the session's 2nd pageview can land on a different page).
apply_page_session_counters(Daily, Session, Page) ->
    NewSession = maps:get(<<"new-session">>, Session, false),
    Unbounced = maps:get(<<"unbounced">>, Session, false),
    PageNewToSession = maps:get(<<"page-new-to-session">>, Session, false),
    Daily1 =
        case NewSession orelse PageNewToSession of
            true ->
                adjust_page_bucket(
                    Daily,
                    Page,
                    fun(Stats) ->
                        Stats#{ <<"sessions">> => int_value(maps:get(<<"sessions">>, Stats, 0), 0) + 1 }
                    end
                );
            false ->
                Daily
        end,
    Daily2 =
        case NewSession of
            true ->
                adjust_page_bucket(
                    Daily1,
                    Page,
                    fun(Stats) ->
                        Stats#{ <<"bounces">> => int_value(maps:get(<<"bounces">>, Stats, 0), 0) + 1 }
                    end
                );
            false ->
                Daily1
        end,
    case Unbounced of
        true ->
            EntryPage = maps:get(<<"entry-page">>, Session, Page),
            adjust_page_bucket(
                Daily2,
                EntryPage,
                fun(Stats) ->
                    Stats#{ <<"bounces">> => max(0, int_value(maps:get(<<"bounces">>, Stats, 0), 0) - 1) }
                end
            );
        false ->
            Daily2
    end.

adjust_page_bucket(Daily, Page, Fun) ->
    ByPath0 = map_value(maps:get(<<"by-path">>, Daily, #{})),
    Stats0 = normalize_page_stats(maps:get(Page, ByPath0, #{})),
    Daily#{ <<"by-path">> => ByPath0#{ Page => Fun(Stats0) } }.

apply_entry_exit(Daily, Session, NewSession) ->
    ByEntry0 = map_value(maps:get(<<"by-entry-page">>, Daily, #{})),
    ByExit0 = map_value(maps:get(<<"by-exit-page">>, Daily, #{})),
    EntryPage = maps:get(<<"entry-page">>, Session, undefined),
    ExitFrom = maps:get(<<"exit-from">>, Session, undefined),
    ExitTo = maps:get(<<"exit-to">>, Session, undefined),
    ByEntry1 =
        case {NewSession, EntryPage} of
            {true, P} when is_binary(P) -> adjust_count(ByEntry0, P, 1);
            _ -> ByEntry0
        end,
    ByExit1 =
        case NewSession of
            true ->
                case ExitTo of
                    P2 when is_binary(P2) -> adjust_count(ByExit0, P2, 1);
                    _ -> ByExit0
                end;
            false ->
                case {ExitFrom, ExitTo} of
                    {F, T} when is_binary(F), is_binary(T), F =/= T ->
                        adjust_count(adjust_count(ByExit0, F, -1), T, 1);
                    _ -> ByExit0
                end
        end,
    Daily#{ <<"by-entry-page">> => ByEntry1, <<"by-exit-page">> => ByExit1 }.

adjust_count(Bucket, Label, Delta) ->
    Bucket#{ Label => max(0, int_value(maps:get(Label, Bucket, 0), 0) + Delta) }.

bool_to_int(true) -> 1;
bool_to_int(_) -> 0.

%% =========================================================================
%% Unique visitors + sessions (privacy-preserving)
%% =========================================================================

%% @doc Per-day visitor id. Persistent-mode sites use the already server-hashed
%% visitor ID as input; daily-mode sites retain the IP + User-Agent estimate.
%% The daily random salt prevents either input from being linked through the
%% ordinary daily visitor marker.
visitor_hash(Key, Date, Demographics, Req, PersistentVisitor, Opts) ->
    Salt = daily_salt(Key, Date, Opts),
    IP = hb_maps:get(<<"ip">>, Demographics, <<"unknown">>, Opts),
    UA = trim_bin(hb_maps:get(<<"user-agent">>, Req, <<>>, Opts)),
    IdentityMaterial =
        case PersistentVisitor of
            #{ <<"hash">> := Hash } -> Hash;
            _ -> <<IP/binary, "|", UA/binary>>
        end,
    Material = <<Salt/binary, "|", Key/binary, "|", IdentityMaterial/binary>>,
    hb_util:human_id(crypto:hash(sha256, Material)).

persistent_visitor(Key, Site, Date, Req, Dimensions, Opts) when is_map(Site) ->
    case site_visitor_id_mode(Site, Opts) of
        <<"persistent">> -> persistent_visitor_enabled(Key, Date, Req, Dimensions, Opts);
        _ -> undefined
    end.

persistent_visitor_enabled(Key, Date, Req, Dimensions, Opts) ->
    case limit_binary(trim_bin(hb_maps:get(<<"visitor-id">>, Req, <<>>, Opts)), 128) of
        <<>> ->
            undefined;
        RawID ->
            Salt = persistent_visitor_salt(Key, Opts),
            Hash = hb_util:human_id(crypto:hash(sha256, <<Salt/binary, "|", Key/binary, "|", RawID/binary>>)),
            Path = persistent_visitor_path(Key, Hash, Opts),
            Resource = {?MODULE, persistent_visitor, path_component(Key), path_component(Hash)},
            global:trans(
                {Resource, self()},
                fun() ->
                    Existing = read_json(Path, undefined, Opts),
                    FirstSeen =
                        case Existing of
                            undefined -> Date;
                            _ -> maps:get(<<"first-seen-date">>, Existing, Date)
                        end,
                    FirstAcquisition =
                        case Existing of
                            undefined -> acquisition_dimensions(Dimensions);
                            _ -> map_value(maps:get(<<"first-acquisition">>, Existing, #{}))
                        end,
                    NewUser = Existing =:= undefined,
                    case Existing of
                        #{ <<"last-seen-date">> := Date } -> ok;
                        _ ->
                            ok =
                                write_json(
                                    Path,
                                    #{
                                        <<"first-seen-date">> => FirstSeen,
                                        <<"first-acquisition">> => FirstAcquisition,
                                        <<"last-seen-date">> => Date,
                                        <<"updated-at">> => now_ms()
                                    },
                                    Opts
                                )
                    end,
                    #{
                        <<"hash">> => Hash,
                        <<"first-seen-date">> => FirstSeen,
                        <<"first-acquisition">> => FirstAcquisition,
                        <<"new-user">> => NewUser
                    }
                end
            )
    end.

persistent_visitor_salt(Key, Opts) ->
    Path = persistent_visitor_salt_path(Key, Opts),
    Resource = {?MODULE, persistent_visitor_salt, path_component(Key)},
    global:trans(
        {Resource, self()},
        fun() ->
            case read_json(Path, undefined, Opts) of
                undefined ->
                    Salt = random_token(?SITE_KEY_BYTES),
                    ok = write_json(Path, #{ <<"salt">> => Salt }, Opts),
                    Salt;
                Record ->
                    maps:get(<<"salt">>, Record, Key)
            end
        end
    ).

apply_persistent_visitor(Daily, undefined, _Demographics, _Dimensions) ->
    Daily;
apply_persistent_visitor(
    Daily,
    #{ <<"hash">> := Hash, <<"first-seen-date">> := FirstSeen },
    Demographics,
    Dimensions
) ->
    Visitors0 = map_value(maps:get(<<"stable-visitors">>, Daily, #{})),
    VisitorDimensions0 = map_value(maps:get(<<"stable-visitor-dimensions">>, Daily, #{})),
    FirstToday = not maps:is_key(Hash, Visitors0),
    NewUser = FirstToday andalso FirstSeen =:= maps:get(<<"date">>, Daily, <<>>),
    Visitors = Visitors0#{ Hash => FirstSeen },
    VisitorDimensions =
        VisitorDimensions0#{
            Hash =>
                maps:get(
                    Hash,
                    VisitorDimensions0,
                    audience_dimensions(Demographics, Dimensions)
                )
        },
    Daily#{
        <<"stable-visitors">> => Visitors,
        <<"stable-visitor-dimensions">> => VisitorDimensions,
        <<"active-users">> => map_size(Visitors),
        <<"new-users">> => int_value(maps:get(<<"new-users">>, Daily, 0), 0) + bool_to_int(NewUser)
    }.

audience_dimensions(Demographics, Dimensions) ->
    Location = map_value(maps:get(<<"location">>, Demographics, #{})),
    #{
        <<"country">> => dimension_label(maps:get(<<"country">>, Location, <<>>)),
        <<"region">> => dimension_label(maps:get(<<"region">>, Location, <<>>)),
        <<"city">> => dimension_label(maps:get(<<"city">>, Location, <<>>)),
        <<"device">> => dimension_label(maps:get(<<"device">>, Dimensions, <<>>)),
        <<"browser">> => dimension_label(maps:get(<<"browser">>, Dimensions, <<>>)),
        <<"os">> => dimension_label(maps:get(<<"os">>, Dimensions, <<>>)),
        <<"language">> => dimension_label(maps:get(<<"language">>, Dimensions, <<>>))
    }.

dimension_label(<<>>) -> <<"Unknown">>;
dimension_label(Value) -> limit_binary(trim_bin(Value), 96).

daily_salt(Key, Date, Opts) ->
    Path = salt_path(Key, Date, Opts),
    case read_json(Path, undefined, Opts) of
        undefined ->
            Salt = random_token(?SITE_KEY_BYTES),
            ok = write_json(Path, #{ <<"salt">> => Salt }, Opts),
            Salt;
        Record ->
            case hb_maps:get(<<"salt">>, Record, <<>>, Opts) of
                <<>> -> Date;
                Salt -> Salt
            end
    end.

engagement_view_bucket(Site, Opts) ->
    Window = site_engagement_dedupe_window_ms(Site, Opts),
    integer_to_binary(now_ms() div Window).

engagement_viewer_id(Key, Site, Req, Opts) ->
    Bucket = engagement_view_bucket(Site, Opts),
    Salt = engagement_bucket_salt(Key, Bucket, Opts),
    IP = client_ip(Req, Opts),
    UA = trim_bin(hb_maps:get(<<"user-agent">>, Req, <<>>, Opts)),
    hb_util:human_id(crypto:hash(sha256, <<Salt/binary, "|", Key/binary, "|", IP/binary, "|", UA/binary>>)).

engagement_bucket_salt(Key, Bucket, Opts) ->
    Path = engagement_salt_path(Key, Bucket, Opts),
    Resource = {?MODULE, engagement_salt, path_component(Key), path_component(Bucket)},
    global:trans(
        {Resource, self()},
        fun() ->
            case read_json(Path, undefined, Opts) of
                undefined ->
                    Salt = random_token(?SITE_KEY_BYTES),
                    ok = write_json(Path, #{ <<"salt">> => Salt }, Opts),
                    Salt;
                Record ->
                    maps:get(<<"salt">>, Record, Bucket)
            end
        end
    ).

%% @doc Record-once visitor marker; returns true the first time a visitor hash
%% is seen on a given day (i.e. a new unique visitor).
mark_visitor(Key, Date, VisitorHash, Opts) ->
    Path = visitor_path(Key, Date, VisitorHash, Opts),
    case hb_store:read(Path, Opts) of
        {ok, _} ->
            false;
        _ ->
            ok = write_json(Path, #{ <<"first-seen">> => now_ms() }, Opts),
            true
    end.

%% @doc Record-once page-view marker; returns true the first time a visitor views
%% a page on a given day. Revisits — and other routes that normalize to the same
%% one-level page — return false, so a page counts as one view per visitor per day.
mark_page_view(Key, Date, VisitorHash, Page, Opts) ->
    Path = page_view_path(Key, Date, VisitorHash, Page, Opts),
    case hb_store:read(Path, Opts) of
        {ok, _} ->
            false;
        _ ->
            ok = write_json(Path, #{ <<"first-seen">> => now_ms() }, Opts),
            true
    end.

%% @doc Open or extend the visitor's session for the day, applying the inactivity
%% window. Returns the increments the daily aggregate should apply.
session_context(Key, Date, VisitorHash, Page, Now, true, _Duration, Dimensions, Opts) ->
    touch_session(Key, Date, VisitorHash, Page, Now, Dimensions, Opts);
session_context(Key, Date, VisitorHash, _Page, Now, false, Duration, _Dimensions, Opts) ->
    touch_session_activity(Key, Date, VisitorHash, Now, Duration, Opts).

touch_session(Key, Date, VisitorHash, Page, Now, Dimensions, Opts) ->
    Path = session_path(Key, Date, VisitorHash, Opts),
    case read_json(Path, undefined, Opts) of
        undefined ->
            open_session(Path, Page, Now, Dimensions, Opts);
        Record ->
            LastSeen = int_value(hb_maps:get(<<"last-seen">>, Record, 0, Opts), 0),
            case Now - LastSeen =< ?SESSION_WINDOW_MS of
                false ->
                    open_session(Path, Page, Now, Dimensions, Opts);
                true ->
                    Pageviews0 = int_value(hb_maps:get(<<"pageviews">>, Record, 1, Opts), 1),
                    ExitFrom = hb_maps:get(<<"exit-page">>, Record, Page, Opts),
                    EntryPage = hb_maps:get(<<"entry-page">>, Record, Page, Opts),
                    Pages0 = map_value(hb_maps:get(<<"pages">>, Record, #{}, Opts)),
                    PageNewToSession = not maps:is_key(Page, Pages0),
                    WasEngaged = truthy(hb_maps:get(<<"engaged">>, Record, false, Opts)),
                    Engaged = WasEngaged orelse (PageNewToSession andalso Pageviews0 >= 1),
                    Updated =
                        Record#{
                            <<"pageviews">> => Pageviews0 + 1,
                            <<"exit-page">> => Page,
                            <<"pages">> => Pages0#{ Page => true },
                            <<"engaged">> => Engaged,
                            <<"last-seen">> => Now
                        },
                    ok = write_json(Path, Updated, Opts),
                    #{
                        <<"new-session">> => false,
                        <<"unbounced">> => Pageviews0 =:= 1,
                        <<"new-engaged-session">> => Engaged andalso not WasEngaged,
                        <<"exit-from">> => ExitFrom,
                        <<"exit-to">> => Page,
                        <<"entry-page">> => EntryPage,
                        <<"acquisition">> =>
                            map_value(hb_maps:get(<<"acquisition">>, Record, #{}, Opts)),
                        <<"page-new-to-session">> => PageNewToSession
                    }
            end
    end.

open_session(Path, Page, Now, Dimensions, Opts) ->
    Acquisition = acquisition_dimensions(Dimensions),
    ok =
        write_json(
            Path,
            #{
                <<"pageviews">> => 1,
                <<"entry-page">> => Page,
                <<"exit-page">> => Page,
                <<"pages">> => #{ Page => true },
                <<"acquisition">> => Acquisition,
                <<"engaged">> => false,
                <<"first-seen">> => Now,
                <<"last-seen">> => Now
            },
            Opts
        ),
    #{
        <<"new-session">> => true,
        <<"unbounced">> => false,
        <<"new-engaged-session">> => false,
        <<"entry-page">> => Page,
        <<"exit-to">> => Page,
        <<"acquisition">> => Acquisition,
        <<"page-new-to-session">> => true
    }.

touch_session_activity(Key, Date, VisitorHash, Now, Duration, Opts) ->
    Path = session_path(Key, Date, VisitorHash, Opts),
    case read_json(Path, undefined, Opts) of
        undefined ->
            #{};
        Record ->
            WasEngaged = truthy(hb_maps:get(<<"engaged">>, Record, false, Opts)),
            Engaged = WasEngaged orelse Duration >= ?ENGAGED_SESSION_MS,
            ok = write_json(Path, Record#{ <<"engaged">> => Engaged, <<"last-seen">> => Now }, Opts),
            #{
                <<"new-session">> => false,
                <<"unbounced">> => false,
                <<"new-engaged-session">> => Engaged andalso not WasEngaged,
                <<"acquisition">> =>
                    map_value(hb_maps:get(<<"acquisition">>, Record, #{}, Opts)),
                <<"page-new-to-session">> => false
            }
    end.

%% =========================================================================
%% Custom events
%% =========================================================================

event_name(Raw) ->
    case limit_binary(trim_bin(Raw), 80) of
        <<>> -> <<"event">>;
        Name -> Name
    end.

event_kind(Req, Opts) ->
    case trim_bin(hb_maps:get(<<"type">>, Req, <<"event">>, Opts)) of
        <<"action">> -> <<"action">>;
        _ -> <<"event">>
    end.

%% @doc The page an event fired on, when the tracker sent one. Older cached
%% copies of the tracker script (before events carried page context) omit
%% this, so those events simply aren't attributed to any page -- rather than
%% guessed at (e.g. defaulting to "/") -- and keep counting only toward the
%% site-wide Top Event/conversion numbers, as they always have.
event_page(Req, Opts) ->
    case trim_bin(hb_maps:get(<<"page">>, Req, <<>>, Opts)) of
        <<>> -> undefined;
        Raw -> sanitize_page(Raw)
    end.

%% @doc Optionally associate a custom event with an arbitrary subject. The
%% event name remains product-defined; analytics only maintains generic
%% per-subject counters alongside the site-wide event report.
event_subject_id(Req, Opts) ->
    case trim_bin(hb_maps:get(<<"subject-id">>, Req, <<>>, Opts)) of
        <<>> -> undefined;
        Raw -> limit_binary(Raw, 512)
    end.

record_subject_event(_Key, undefined, _Name, _Opts) ->
    ok;
record_subject_event(Key, SubjectID, Name, Opts) ->
    with_subject_lock(
        Key,
        SubjectID,
        fun() ->
            ok = ensure_group(subjects_path(Key, Opts), Opts),
            Path = subject_path(Key, SubjectID, Opts),
            Aggregate0 = read_json(Path, subject_default(SubjectID), Opts),
            Events0 = map_value(maps:get(<<"events">>, Aggregate0, #{})),
            Aggregate =
                Aggregate0#{
                    <<"events">> =>
                        Events0#{ Name => int_value(maps:get(Name, Events0, 0), 0) + 1 },
                    <<"updated-at">> => now_ms()
                },
            write_json(Path, Aggregate, Opts)
        end
    ).

record_event(Key, Date, Name, Kind, Value, Page, Opts) ->
    Path = daily_path(Key, Date, Opts),
    Daily0 = normalize_daily(Date, read_json(Path, daily_default(Date), Opts)),
    ByEvent0 = map_value(hb_maps:get(<<"by-event">>, Daily0, #{}, Opts)),
    Daily1 =
        Daily0#{
            <<"events">> => int_value(hb_maps:get(<<"events">>, Daily0, 0, Opts), 0) + 1,
            <<"by-event">> => ByEvent0#{ Name => increment_event_stats(ByEvent0, Name, Value) },
            <<"updated-at">> => now_ms()
        },
    Daily2 = record_page_event(Daily1, Page, Name, Value),
    Daily3 = record_action(Daily2, Page, Name, Kind, Value),
    write_json(Path, Daily3, Opts).

record_action(Daily, _Page, _Name, <<"event">>, _Value) ->
    Daily;
record_action(Daily, Page, Name, <<"action">>, Value) ->
    ByAction0 = map_value(maps:get(<<"by-action">>, Daily, #{})),
    Daily1 =
        Daily#{
            <<"actions">> => int_value(maps:get(<<"actions">>, Daily, 0), 0) + 1,
            <<"by-action">> => ByAction0#{ Name => increment_event_stats(ByAction0, Name, Value) }
        },
    record_page_action(Daily1, Page, Name, Value).

record_page_action(Daily, undefined, _Name, _Value) ->
    Daily;
record_page_action(Daily, Page, Name, Value) ->
    ByPath0 = map_value(maps:get(<<"by-path">>, Daily, #{})),
    PageStats0 = normalize_page_stats(maps:get(Page, ByPath0, #{})),
    ByAction0 = maps:get(<<"by-action">>, PageStats0, #{}),
    PageStats1 = PageStats0#{ <<"by-action">> => ByAction0#{ Name => increment_event_stats(ByAction0, Name, Value) } },
    Daily#{ <<"by-path">> => ByPath0#{ Page => PageStats1 } }.

increment_event_stats(ByEvent, Name, Value) ->
    Stats0 = normalize_event_stats(maps:get(Name, ByEvent, #{})),
    Stats0#{
        <<"name">> => Name,
        <<"count">> => int_value(maps:get(<<"count">>, Stats0, 0), 0) + 1,
        <<"value">> => int_value(maps:get(<<"value">>, Stats0, 0), 0) + Value
    }.

%% @doc Mirror the event onto `by-path[Page].by-event' when the tracker sent
%% a page (see `event_page/2'); a no-op for events without one.
record_page_event(Daily, undefined, _Name, _Value) ->
    Daily;
record_page_event(Daily, Page, Name, Value) ->
    ByPath0 = map_value(maps:get(<<"by-path">>, Daily, #{})),
    PageStats0 = normalize_page_stats(maps:get(Page, ByPath0, #{})),
    PageByEvent0 = maps:get(<<"by-event">>, PageStats0, #{}),
    PageStats1 = PageStats0#{ <<"by-event">> => PageByEvent0#{ Name => increment_event_stats(PageByEvent0, Name, Value) } },
    Daily#{ <<"by-path">> => ByPath0#{ Page => PageStats1 } }.

normalize_event_stats(Raw) ->
    Stats = map_value(Raw),
    Stats#{
        <<"count">> => int_value(maps:get(<<"count">>, Stats, 0), 0),
        <<"value">> => int_value(maps:get(<<"value">>, Stats, 0), 0)
    }.

%% =========================================================================
%% Report-side aggregation for the new sections
%% =========================================================================

acquisition_from_days(Daily) ->
    #{
        <<"referrers">> => demographic_items_from_days(Daily, <<"by-referrer">>, <<"referrer">>),
        <<"utm-sources">> => demographic_items_from_days(Daily, <<"by-utm-source">>, <<"utm-source">>),
        <<"utm-mediums">> => demographic_items_from_days(Daily, <<"by-utm-medium">>, <<"utm-medium">>),
        <<"utm-campaigns">> => demographic_items_from_days(Daily, <<"by-utm-campaign">>, <<"utm-campaign">>),
        <<"first-touch">> => attribution_from_days(Daily, <<"by-first">>, <<"users">>),
        <<"session-touch">> => attribution_from_days(Daily, <<"by-session">>, <<"sessions">>)
    }.

attribution_from_days(Daily, Prefix, SortKey) ->
    #{
        <<"referrers">> =>
            attribution_items_from_days(
                Daily,
                <<Prefix/binary, "-referrer">>,
                <<"referrer">>,
                SortKey
            ),
        <<"utm-sources">> =>
            attribution_items_from_days(
                Daily,
                <<Prefix/binary, "-utm-source">>,
                <<"utm-source">>,
                SortKey
            ),
        <<"utm-mediums">> =>
            attribution_items_from_days(
                Daily,
                <<Prefix/binary, "-utm-medium">>,
                <<"utm-medium">>,
                SortKey
            ),
        <<"utm-campaigns">> =>
            attribution_items_from_days(
                Daily,
                <<Prefix/binary, "-utm-campaign">>,
                <<"utm-campaign">>,
                SortKey
            )
    }.

attribution_items_from_days(Daily, BucketKey, LabelKey, SortKey) ->
    Items =
        lists:foldl(
            fun(Day, Acc) ->
                maps:fold(
                    fun(Label0, RawStats, ItemAcc) ->
                        Stats = map_value(RawStats),
                        Label = maps:get(LabelKey, Stats, Label0),
                        Existing = map_value(maps:get(Label, ItemAcc, #{})),
                        Counters = maps:without([LabelKey], Stats),
                        Merged =
                            maps:fold(
                                fun(Counter, Value, StatsAcc) ->
                                    StatsAcc#{
                                        Counter =>
                                            int_value(maps:get(Counter, StatsAcc, 0), 0) +
                                                int_value(Value, 0)
                                    }
                                end,
                                Existing#{ LabelKey => Label },
                                Counters
                            ),
                        ItemAcc#{ Label => Merged }
                    end,
                    Acc,
                    map_value(maps:get(BucketKey, Day, #{}))
                )
            end,
            #{},
            Daily
        ),
    lists:sublist(
        lists:sort(
            fun(A, B) -> maps:get(SortKey, A, 0) >= maps:get(SortKey, B, 0) end,
            maps:values(Items)
        ),
        50
    ).

technology_from_days(Daily) ->
    #{
        <<"devices">> => demographic_items_from_days(Daily, <<"by-device">>, <<"device">>),
        <<"browsers">> => demographic_items_from_days(Daily, <<"by-browser">>, <<"browser">>),
        <<"operating-systems">> => demographic_items_from_days(Daily, <<"by-os">>, <<"os">>),
        <<"languages">> => demographic_items_from_days(Daily, <<"by-language">>, <<"language">>)
    }.

navigation_from_days(Daily) ->
    #{
        <<"landing-pages">> => count_items_from_days(Daily, <<"by-entry-page">>),
        <<"exit-pages">> => count_items_from_days(Daily, <<"by-exit-page">>)
    }.

count_items_from_days(Daily, BucketKey) ->
    Items =
        lists:foldl(
            fun(Day, Acc) ->
                Buckets = map_value(maps:get(BucketKey, Day, #{})),
                maps:fold(
                    fun(Label, RawCount, ItemAcc) ->
                        Count = int_value(RawCount, 0),
                        maps:update_with(Label, fun(C) -> C + Count end, Count, ItemAcc)
                    end,
                    Acc,
                    Buckets
                )
            end,
            #{},
            Daily
        ),
    lists:sublist(
        lists:sort(
            fun(A, B) -> maps:get(<<"sessions">>, A, 0) >= maps:get(<<"sessions">>, B, 0) end,
            [
                #{ <<"page">> => Label, <<"sessions">> => Count }
             || {Label, Count} <- maps:to_list(Items), Count > 0
            ]
        ),
        50
    ).

events_from_days(Daily, Sessions) ->
    named_metrics_from_days(Daily, <<"by-event">>, Sessions).

actions_from_days(Daily, Sessions) ->
    named_metrics_from_days(Daily, <<"by-action">>, Sessions).

named_metrics_from_days(Daily, BucketKey, Sessions) ->
    Items =
        lists:foldl(
            fun(Day, Acc) ->
                ByEvent = map_value(maps:get(BucketKey, Day, #{})),
                maps:fold(
                    fun(Name, RawStats, ItemAcc) ->
                        Stats = normalize_event_stats(RawStats),
                        Existing = maps:get(Name, ItemAcc, #{ <<"count">> => 0, <<"value">> => 0 }),
                        ItemAcc#{
                            Name =>
                                #{
                                    <<"count">> =>
                                        maps:get(<<"count">>, Existing, 0) +
                                            int_value(maps:get(<<"count">>, Stats, 0), 0),
                                    <<"value">> =>
                                        maps:get(<<"value">>, Existing, 0) +
                                            int_value(maps:get(<<"value">>, Stats, 0), 0)
                                }
                        }
                    end,
                    Acc,
                    ByEvent
                )
            end,
            #{},
            Daily
        ),
    Rows =
        [
            #{
                <<"name">> => Name,
                <<"count">> => maps:get(<<"count">>, S, 0),
                <<"value">> => maps:get(<<"value">>, S, 0),
                <<"conversion-rate">> => conversion_rate(maps:get(<<"count">>, S, 0), Sessions)
            }
         || {Name, S} <- maps:to_list(Items)
        ],
    lists:sublist(
        lists:sort(fun(A, B) -> maps:get(<<"count">>, A, 0) >= maps:get(<<"count">>, B, 0) end, Rows),
        50
    ).

conversion_rate(_Count, Sessions) when Sessions =< 0 ->
    0.0;
conversion_rate(Count, Sessions) ->
    Count / Sessions.

%% @doc Realtime: the active visit count's top pages over the active window,
%% optionally scoped to `Route' (see `active_visits/3').
active_pages(Key, Route, Opts) ->
    Date = today(),
    Window = active_window_ms(Opts),
    Now = now_ms(),
    ok = ensure_group(visits_day_path(Key, Date, Opts), Opts),
    Counts =
        case hb_store:list(visits_day_path(Key, Date, Opts), Opts) of
            {ok, VisitIDs} ->
                lists:foldl(
                    fun(VisitID, Acc) ->
                        Visit = read_json(visit_path(Key, Date, VisitID, Opts), undefined, Opts),
                        case active_visit(Visit, Now, Window) of
                            true ->
                                Page = maps:get(<<"page">>, Visit, <<"/">>),
                                case page_matches_route(Page, Route) of
                                    true -> maps:update_with(Page, fun(C) -> C + 1 end, 1, Acc);
                                    false -> Acc
                                end;
                            false ->
                                Acc
                        end
                    end,
                    #{},
                    VisitIDs
                );
            _ ->
                #{}
        end,
    lists:sublist(
        lists:sort(
            fun(A, B) -> maps:get(<<"active">>, A, 0) >= maps:get(<<"active">>, B, 0) end,
            [#{ <<"page">> => P, <<"active">> => C } || {P, C} <- maps:to_list(Counts)]
        ),
        10
    ).

salt_path(Key, Date, Opts) ->
    store_path([<<"salts">>, path_component(Key), path_component(Date)], Opts).

persistent_visitor_salt_path(Key, Opts) ->
    store_path([<<"persistent-visitor-salts">>, path_component(Key)], Opts).

persistent_visitor_path(Key, VisitorHash, Opts) ->
    store_path(
        [<<"persistent-visitors">>, path_component(Key), path_component(VisitorHash)],
        Opts
    ).

engagement_salt_path(Key, Bucket, Opts) ->
    store_path([<<"engagement-salts">>, path_component(Key), path_component(Bucket)], Opts).

engagement_view_path(Key, SubjectID, Bucket, ViewerID, Opts) ->
    Slug = hb_util:human_id(crypto:hash(sha256, <<SubjectID/binary, "|", ViewerID/binary>>)),
    store_path(
        [<<"engagement-views">>, path_component(Key), path_component(Bucket), path_component(Slug)],
        Opts
    ).

visitor_path(Key, Date, VisitorHash, Opts) ->
    store_path(
        [<<"visitors">>, path_component(Key), path_component(Date), path_component(VisitorHash)],
        Opts
    ).

page_view_path(Key, Date, VisitorHash, Page, Opts) ->
    Slug = hb_util:human_id(crypto:hash(sha256, <<VisitorHash/binary, "|", Page/binary>>)),
    store_path(
        [<<"page-views">>, path_component(Key), path_component(Date), path_component(Slug)],
        Opts
    ).

session_path(Key, Date, VisitorHash, Opts) ->
    store_path(
        [<<"sessions">>, path_component(Key), path_component(Date), path_component(VisitorHash)],
        Opts
    ).

-ifdef(TEST).
-include_lib("eunit/include/eunit.hrl").

test_opts() ->
    Store = hb_test_utils:test_store(),
    hb_store:reset(Store),
    #{ <<"store">> => Store }.

%% @doc Build options backed by the persistent LMDB store, matching the store
%% a running node actually uses. The default `test_opts/0' store
%% (`hb_store_volatile') auto-creates parent groups on write, which masks the
%% group-marker requirement that LMDB enforces for `hb_store:list/2'. The
%% listing-oriented tests below run against both so the LMDB behaviour is
%% covered.
lmdb_opts() ->
    Store = hb_test_utils:test_store(hb_store_lmdb),
    hb_store:reset(Store),
    #{ <<"store">> => Store }.

listing_store_opts() ->
    [test_opts(), lmdb_opts()].

signed_req(Req, Wallet, Opts) ->
    hb_message:commit(Req, Opts#{ <<"priv-wallet">> => Wallet }).

register_requires_auth_test() ->
    Opts = test_opts(),
    {ok, Res} = register(#{}, #{ <<"name">> => <<"Docs">> }, Opts),
    ?assertEqual(401, maps:get(<<"status">>, Res)).

nonce_creates_auth_message_test() ->
    Opts = test_opts(),
    Owner = <<"owner-address">>,
    {ok, Res} = nonce(#{}, #{ <<"owner">> => Owner }, Opts),
    Body = hb_json:decode(maps:get(<<"body">>, Res)),
    Nonce = maps:get(<<"nonce">>, Body),
    Message = maps:get(<<"message">>, Body),
    ?assert(byte_size(Nonce) > 20),
    ?assertNotEqual(nomatch, binary:match(Message, Owner)),
    ?assertNotEqual(undefined, read_json(nonce_path(Owner, Nonce, Opts), undefined, Opts)).

register_signed_request_creates_site_test() ->
    Opts = test_opts(),
    Wallet = ar_wallet:new(),
    Owner = hb_util:human_id(ar_wallet:to_address(Wallet)),
    Req =
        signed_req(
            #{
                <<"name">> => <<"Docs">>,
                <<"origin">> => <<"https://example.com">>
            },
            Wallet,
            Opts
        ),
    {ok, Res} = register(#{}, Req, Opts),
    Body = hb_json:decode(maps:get(<<"body">>, Res)),
    Site = maps:get(<<"site">>, Body),
    ?assertEqual(Owner, maps:get(<<"owner">>, Site)),
    ?assertEqual(<<"Docs">>, maps:get(<<"name">>, Site)),
    ?assertMatch(<<_/binary>>, maps:get(<<"key">>, Body)),
    ?assertNotEqual(nomatch, binary:match(maps:get(<<"snippet">>, Body), <<"~analytics@1.0/script">>)).

external_frontend_not_exported_test() ->
    Info = info(#{}),
    ?assertNot(lists:member(<<"index">>, maps:get(exports, Info))),
    ?assertNot(maps:is_key(default, Info)).

configured_site_is_immediately_active_test() ->
    Wallet = ar_wallet:new(),
    Opts =
        (test_opts())#{
            <<"priv-wallet">> => Wallet,
            <<"analytics-sites">> =>
                [
                    #{
                        <<"key">> => <<"configured-key">>,
                        <<"name">> => <<"Configured site">>,
                        <<"origins">> => [<<"https://example.com">>],
                        <<"engagement-threshold-ms">> => 2_000
                    }
                ]
        },
    Site = read_active_site(<<"configured-key">>, Opts),
    ?assertEqual(<<"Configured site">>, maps:get(<<"name">>, Site)),
    ?assertEqual(2_000, maps:get(<<"engagement-threshold-ms">>, Site)),
    ?assertEqual(
        hb_util:human_id(ar_wallet:to_address(Wallet)),
        maps:get(<<"owner">>, Site)
    ),
    {ok, Res} =
        session(
            #{},
            #{
                <<"key">> => <<"configured-key">>,
                <<"visit">> => <<"visit-1">>,
                <<"event">> => <<"start">>,
                <<"page">> => <<"/">>,
                <<"origin">> => <<"https://example.com">>
            },
            Opts
        ),
    ?assertEqual(200, maps:get(<<"status">>, Res)),
    {ok, SitesRes} = sites(#{}, signed_req(#{}, Wallet, Opts), Opts),
    [ConfiguredSite] = maps:get(<<"sites">>, hb_json:decode(maps:get(<<"body">>, SitesRes))),
    ?assertEqual(<<"configured-key">>, maps:get(<<"key">>, ConfiguredSite)).

subject_scoped_events_are_exposed_in_counts_test() ->
    Opts = test_opts(),
    Wallet = ar_wallet:new(),
    RegReq = signed_req(#{ <<"name">> => <<"Subject events">> }, Wallet, Opts),
    {ok, RegRes} = register(#{}, RegReq, Opts),
    Key = maps:get(<<"key">>, hb_json:decode(maps:get(<<"body">>, RegRes))),
    EventReq =
        #{
            <<"key">> => Key,
            <<"name">> => <<"impression">>,
            <<"subject-id">> => <<"subject-1">>,
            <<"page">> => <<"/discover">>
        },
    {ok, FirstRes} = event(#{}, EventReq, Opts),
    ?assertEqual(<<"subject-1">>, maps:get(<<"subject-id">>, hb_json:decode(maps:get(<<"body">>, FirstRes)))),
    {ok, _} = event(#{}, EventReq, Opts),
    {ok, _} = event(#{}, EventReq#{ <<"subject-id">> => <<"subject-2">> }, Opts),
    {ok, CountsRes} =
        counts(
            #{},
            #{ <<"key">> => Key, <<"subject-ids">> => [<<"subject-1">>, <<"subject-2">>] },
            Opts
        ),
    [FirstCount, SecondCount] = maps:get(<<"counts">>, hb_json:decode(maps:get(<<"body">>, CountsRes))),
    ?assertEqual(2, maps:get(<<"impression">>, maps:get(<<"events">>, FirstCount))),
    ?assertEqual(1, maps:get(<<"impression">>, maps:get(<<"events">>, SecondCount))),
    ?assertEqual(0, maps:get(<<"total">>, FirstCount)).

engagement_is_idempotent_and_qualifies_once_test() ->
    Opts =
        (test_opts())#{
            <<"analytics-engagement-threshold-ms">> => 1_000,
            <<"analytics-engagement-clock-skew-ms">> => 10_000
        },
    Wallet = ar_wallet:new(),
    RegReq =
        signed_req(
            #{
                <<"name">> => <<"Media">>,
                <<"origin">> => <<"https://example.com">>,
                <<"engagement-threshold-ms">> => 1_000
            },
            Wallet,
            Opts
        ),
    {ok, RegRes} = register(#{}, RegReq, Opts),
    Key = maps:get(<<"key">>, hb_json:decode(maps:get(<<"body">>, RegRes))),
    Base =
        #{
            <<"key">> => Key,
            <<"subject-id">> => <<"subject-1">>,
            <<"interaction-id">> => <<"interaction-1">>,
            <<"origin">> => <<"https://example.com">>
        },
    {ok, StartRes} =
        engagement(
            #{},
            Base#{
                <<"event">> => <<"start">>,
                <<"sequence">> => 0,
                <<"active-ms">> => 0,
                <<"position-ms">> => 0
            },
            Opts
        ),
    ?assertEqual(200, maps:get(<<"status">>, StartRes)),
    Heartbeat =
        Base#{
            <<"event">> => <<"heartbeat">>,
            <<"sequence">> => 1,
            <<"active-ms">> => 1_000,
            <<"position-ms">> => 1_000
        },
    {ok, HeartbeatRes} = engagement(#{}, Heartbeat, Opts),
    HeartbeatBody = hb_json:decode(maps:get(<<"body">>, HeartbeatRes)),
    ?assertEqual(false, maps:get(<<"idempotent">>, HeartbeatBody)),
    HeartbeatInteraction = maps:get(<<"interaction">>, HeartbeatBody),
    ?assert(maps:get(<<"qualified-at">>, HeartbeatInteraction) > 0),
    ?assert(maps:get(<<"view-counted-at">>, HeartbeatInteraction) > 0),
    {ok, DuplicateRes} = engagement(#{}, Heartbeat, Opts),
    DuplicateBody = hb_json:decode(maps:get(<<"body">>, DuplicateRes)),
    ?assertEqual(true, maps:get(<<"idempotent">>, DuplicateBody)),
    {ok, CountRes} =
        count(
            #{},
            #{
                <<"key">> => Key,
                <<"subject-id">> => <<"subject-1">>,
                <<"origin">> => <<"https://example.com">>
            },
            Opts
        ),
    CountBody = hb_json:decode(maps:get(<<"body">>, CountRes)),
    ?assertEqual(1, maps:get(<<"raw">>, CountBody)),
    ?assertEqual(1, maps:get(<<"qualified">>, CountBody)),
    ?assertEqual(1_000, maps:get(<<"active-ms">>, CountBody)),
    ?assertEqual(0, maps:get(<<"completions">>, CountBody)),
    ?assertEqual(1, maps:get(<<"total">>, CountBody)),
    {ok, CountsRes} =
        counts(
            #{},
            #{
                <<"key">> => Key,
                <<"subject-ids">> => <<"subject-1,subject-2">>,
                <<"origin">> => <<"https://example.com">>
            },
            Opts
        ),
    [FirstCount, SecondCount] = maps:get(<<"counts">>, hb_json:decode(maps:get(<<"body">>, CountsRes))),
    ?assertEqual(1, maps:get(<<"total">>, FirstCount)),
    ?assertEqual(0, maps:get(<<"total">>, SecondCount)).

completed_play_allows_one_evidenced_replay_test() ->
    Opts =
        (test_opts())#{
            <<"analytics-engagement-threshold-ms">> => 1_000,
            <<"analytics-engagement-clock-skew-ms">> => 10_000,
            <<"analytics-engagement-dedupe-window-ms">> => 86_400_000
        },
    Wallet = ar_wallet:new(),
    RegReq = signed_req(#{ <<"name">> => <<"Media">> }, Wallet, Opts),
    {ok, RegRes} = register(#{}, RegReq, Opts),
    Key = maps:get(<<"key">>, hb_json:decode(maps:get(<<"body">>, RegRes))),
    Base =
        #{
            <<"key">> => Key,
            <<"subject-id">> => <<"subject-1">>,
            <<"x-forwarded-for">> => <<"203.0.113.10">>,
            <<"user-agent">> => <<"analytics-test">>
        },
    First = Base#{ <<"interaction-id">> => <<"interaction-1">> },
    {ok, _} = engagement(#{}, First#{ <<"event">> => <<"start">>, <<"sequence">> => 0, <<"active-ms">> => 0, <<"position-ms">> => 0 }, Opts),
    {ok, _} = engagement(#{}, First#{ <<"event">> => <<"heartbeat">>, <<"sequence">> => 1, <<"active-ms">> => 1_000, <<"position-ms">> => 1_000 }, Opts),
    {ok, CompleteRes} = engagement(#{}, First#{ <<"event">> => <<"complete">>, <<"sequence">> => 2, <<"active-ms">> => 1_000, <<"position-ms">> => 1_000 }, Opts),
    CompleteInteraction = maps:get(<<"interaction">>, hb_json:decode(maps:get(<<"body">>, CompleteRes))),
    ?assert(maps:get(<<"completed-at">>, CompleteInteraction) > 0),
    ?assert(maps:get(<<"ended-at">>, CompleteInteraction) > 0),
    Second = Base#{ <<"interaction-id">> => <<"interaction-2">> },
    {ok, _} = engagement(#{}, Second#{ <<"event">> => <<"start">>, <<"sequence">> => 0, <<"active-ms">> => 0, <<"position-ms">> => 0 }, Opts),
    {ok, _} = engagement(#{}, Second#{ <<"event">> => <<"heartbeat">>, <<"sequence">> => 1, <<"active-ms">> => 1_000, <<"position-ms">> => 1_000 }, Opts),
    Third = Base#{ <<"interaction-id">> => <<"interaction-3">> },
    {ok, _} = engagement(#{}, Third#{ <<"event">> => <<"start">>, <<"sequence">> => 0, <<"active-ms">> => 0, <<"position-ms">> => 0 }, Opts),
    {ok, _} = engagement(#{}, Third#{ <<"event">> => <<"heartbeat">>, <<"sequence">> => 1, <<"active-ms">> => 1_000, <<"position-ms">> => 1_000 }, Opts),
    {ok, CountRes} = count(#{}, #{ <<"key">> => Key, <<"subject-id">> => <<"subject-1">> }, Opts),
    CountBody = hb_json:decode(maps:get(<<"body">>, CountRes)),
    ?assertEqual(3, maps:get(<<"raw">>, CountBody)),
    ?assertEqual(2, maps:get(<<"qualified">>, CountBody)),
    ?assertEqual(3_000, maps:get(<<"active-ms">>, CountBody)),
    ?assertEqual(1, maps:get(<<"completions">>, CountBody)),
    ?assertEqual(2, maps:get(<<"total">>, CountBody)).

engagement_rejects_regressions_test() ->
    Opts =
        (test_opts())#{
            <<"analytics-engagement-threshold-ms">> => 1_000,
            <<"analytics-engagement-clock-skew-ms">> => 10_000
        },
    Wallet = ar_wallet:new(),
    RegReq = signed_req(#{ <<"name">> => <<"Media">> }, Wallet, Opts),
    {ok, RegRes} = register(#{}, RegReq, Opts),
    Key = maps:get(<<"key">>, hb_json:decode(maps:get(<<"body">>, RegRes))),
    Base =
        #{
            <<"key">> => Key,
            <<"subject-id">> => <<"subject-1">>,
            <<"interaction-id">> => <<"interaction-1">>
        },
    {ok, _} =
        engagement(
            #{},
            Base#{
                <<"event">> => <<"start">>,
                <<"sequence">> => 0,
                <<"active-ms">> => 0,
                <<"position-ms">> => 100
            },
            Opts
        ),
    {ok, RegressionRes} =
        engagement(
            #{},
            Base#{
                <<"event">> => <<"heartbeat">>,
                <<"sequence">> => 1,
                <<"active-ms">> => 100,
                <<"position-ms">> => 50
            },
            Opts
        ),
    ?assertEqual(422, maps:get(<<"status">>, RegressionRes)),
    {ok, CountRes} = count(#{}, #{ <<"key">> => Key, <<"subject-id">> => <<"subject-1">> }, Opts),
    CountBody = hb_json:decode(maps:get(<<"body">>, CountRes)),
    ?assertEqual(1, maps:get(<<"suspicious">>, CountBody)),
    ?assertEqual(0, maps:get(<<"qualified">>, CountBody)).

baseline_is_authenticated_immutable_and_included_in_total_test() ->
    Opts = test_opts(),
    Wallet = ar_wallet:new(),
    RegReq = signed_req(#{ <<"name">> => <<"Migration">> }, Wallet, Opts),
    {ok, RegRes} = register(#{}, RegReq, Opts),
    Key = maps:get(<<"key">>, hb_json:decode(maps:get(<<"body">>, RegRes))),
    BaselineFields =
        #{
            <<"key">> => Key,
            <<"subject-id">> => <<"subject-1">>,
            <<"value">> => 42,
            <<"version">> => <<"legacy-2026-08-20">>,
            <<"cutover-at">> => 1_787_184_000,
            <<"source">> => <<"legacy-export">>
        },
    {ok, BaselineRes} = baseline(#{}, signed_req(BaselineFields, Wallet, Opts), Opts),
    BaselineBody = hb_json:decode(maps:get(<<"body">>, BaselineRes)),
    CountBody = maps:get(<<"count">>, BaselineBody),
    ?assertEqual(42, maps:get(<<"baseline">>, CountBody)),
    ?assertEqual(42, maps:get(<<"total">>, CountBody)),
    {ok, DuplicateRes} = baseline(#{}, signed_req(BaselineFields, Wallet, Opts), Opts),
    ?assertEqual(true, maps:get(<<"idempotent">>, hb_json:decode(maps:get(<<"body">>, DuplicateRes)))),
    ConflictFields = BaselineFields#{ <<"value">> => 43 },
    {ok, ConflictRes} = baseline(#{}, signed_req(ConflictFields, Wallet, Opts), Opts),
    ?assertEqual(409, maps:get(<<"status">>, ConflictRes)).

configured_node_baseline_writer_is_limited_to_node_signer_test() ->
    NodeWallet = ar_wallet:new(),
    OwnerWallet = ar_wallet:new(),
    OtherWallet = ar_wallet:new(),
    Owner = hb_util:human_id(ar_wallet:to_address(OwnerWallet)),
    Key = <<"configured-migration">>,
    Opts =
        (test_opts())#{
            <<"priv-wallet">> => NodeWallet,
            <<"analytics-sites">> =>
                [
                    #{
                        <<"key">> => Key,
                        <<"name">> => <<"Configured migration">>,
                        <<"owner">> => Owner,
                        <<"node-baseline-writer">> => true
                    }
                ]
        },
    Fields =
        #{
            <<"key">> => Key,
            <<"subject-id">> => <<"subject-node">>,
            <<"value">> => 17,
            <<"version">> => <<"source-v1">>,
            <<"cutover-at">> => 0,
            <<"source">> => <<"source">>
        },
    {ok, NodeRes} = baseline(#{}, signed_req(Fields, NodeWallet, Opts), Opts),
    ?assertEqual(200, maps:get(<<"status">>, NodeRes)),
    {ok, OtherRes} =
        baseline(
            #{},
            signed_req(Fields#{ <<"subject-id">> => <<"subject-other">> }, OtherWallet, Opts),
            Opts
        ),
    ?assertEqual(403, maps:get(<<"status">>, OtherRes)),
    {ok, OwnerRes} =
        baseline(
            #{},
            signed_req(Fields#{ <<"subject-id">> => <<"subject-owner">> }, OwnerWallet, Opts),
            Opts
        ),
    ?assertEqual(200, maps:get(<<"status">>, OwnerRes)).

subjects_lists_authorized_paginated_aggregates_test() ->
    Opts = test_opts(),
    Wallet = ar_wallet:new(),
    RegReq = signed_req(#{ <<"name">> => <<"Subjects">> }, Wallet, Opts),
    {ok, RegRes} = register(#{}, RegReq, Opts),
    Key = maps:get(<<"key">>, hb_json:decode(maps:get(<<"body">>, RegRes))),
    Import =
        fun(SubjectID, Value) ->
            Fields =
                #{
                    <<"key">> => Key,
                    <<"subject-id">> => SubjectID,
                    <<"value">> => Value,
                    <<"version">> => <<"migration-v1">>,
                    <<"cutover-at">> => 1_787_184_000,
                    <<"source">> => <<"migration">>
                },
            {ok, Result} = baseline(#{}, signed_req(Fields, Wallet, Opts), Opts),
            ?assertEqual(200, maps:get(<<"status">>, Result))
        end,
    Import(<<"subject-1">>, 10),
    Import(<<"subject-2">>, 20),
    Request =
        signed_req(
            #{ <<"key">> => Key, <<"page">> => 1, <<"page-size">> => 1 },
            Wallet,
            Opts
        ),
    {ok, Page1Res} = subjects(#{}, Request, Opts),
    Page1 = hb_json:decode(maps:get(<<"body">>, Page1Res)),
    ?assertEqual(2, maps:get(<<"total">>, Page1)),
    ?assertEqual(1, maps:get(<<"page-size">>, Page1)),
    ?assertEqual(1, length(maps:get(<<"subjects">>, Page1))),
    {ok, Page2Res} =
        subjects(
            #{},
            signed_req(
                #{ <<"key">> => Key, <<"page">> => 2, <<"page-size">> => 1 },
                Wallet,
                Opts
            ),
            Opts
        ),
    [First] = maps:get(<<"subjects">>, Page1),
    [Second] = maps:get(
        <<"subjects">>,
        hb_json:decode(maps:get(<<"body">>, Page2Res))
    ),
    ?assertNotEqual(maps:get(<<"subject-id">>, First), maps:get(<<"subject-id">>, Second)),
    ?assertEqual(30, maps:get(<<"total">>, First) + maps:get(<<"total">>, Second)).

track_updates_daily_report_test() ->
    Opts = test_opts(),
    Wallet = ar_wallet:new(),
    RegReq =
        signed_req(
            #{
                <<"name">> => <<"Docs">>,
                <<"origin">> => <<"https://example.com">>
            },
            Wallet,
            Opts
        ),
    {ok, RegRes} = register(#{}, RegReq, Opts),
    Key = maps:get(<<"key">>, hb_json:decode(maps:get(<<"body">>, RegRes))),
    TrackBase =
        #{
            <<"key">> => Key,
            <<"visit">> => <<"visit-1">>,
            <<"page">> => <<"/docs">>,
            <<"origin">> => <<"https://example.com">>,
            <<"x-forwarded-for">> => <<"203.0.113.10, 10.0.0.1">>,
            <<"x-vercel-ip-country">> => <<"US">>,
            <<"x-vercel-ip-country-region">> => <<"NY">>,
            <<"x-vercel-ip-city">> => <<"New York">>
        },
    {ok, _} = session(#{}, TrackBase#{ <<"event">> => <<"start">>, <<"duration">> => <<"0">> }, Opts),
    {ok, _} =
        session(
            #{},
            TrackBase#{ <<"event">> => <<"heartbeat">>, <<"duration">> => <<"12000">> },
            Opts
        ),
    ReportReq = signed_req(#{ <<"key">> => Key, <<"days">> => <<"1">> }, Wallet, Opts),
    {ok, ReportRes} = report(#{}, ReportReq, Opts),
    Report = hb_json:decode(maps:get(<<"body">>, ReportRes)),
    Summary = maps:get(<<"summary">>, Report),
    [Page] = maps:get(<<"pages">>, Report),
    Demographics = maps:get(<<"demographics">>, Report),
    [IP] = maps:get(<<"ips">>, Demographics),
    [Location] = maps:get(<<"locations">>, Demographics),
    ?assertEqual(1, maps:get(<<"page-loads">>, Summary)),
    ?assertEqual(1, maps:get(<<"visits">>, Summary)),
    ?assertEqual(12000, maps:get(<<"duration-ms">>, Summary)),
    ?assertEqual(<<"/docs">>, maps:get(<<"page">>, Page)),
    ?assertEqual(1, maps:get(<<"page-loads">>, Page)),
    ?assertEqual(1, maps:get(<<"visits">>, Page)),
    ?assertEqual(<<"203.0.113.10">>, maps:get(<<"ip">>, IP)),
    ?assertEqual(1, maps:get(<<"visits">>, IP)),
    ?assertEqual(<<"New York, NY, US">>, maps:get(<<"location">>, Location)),
    ?assertEqual(1, maps:get(<<"visits">>, Location)).

owner_auth_required_for_report_test() ->
    Opts = test_opts(),
    OwnerWallet = ar_wallet:new(),
    OtherWallet = ar_wallet:new(),
    RegReq = signed_req(#{ <<"name">> => <<"Docs">> }, OwnerWallet, Opts),
    {ok, RegRes} = register(#{}, RegReq, Opts),
    Key = maps:get(<<"key">>, hb_json:decode(maps:get(<<"body">>, RegRes))),
    ReportReq = signed_req(#{ <<"key">> => Key }, OtherWallet, Opts),
    {ok, ReportRes} = report(#{}, ReportReq, Opts),
    ?assertEqual(403, maps:get(<<"status">>, ReportRes)).

invited_wallet_can_list_and_report_test_() ->
    [
        {
            "invited wallet can list and report shared site (" ++ atom_to_list(store_module(Opts)) ++ ")",
            fun() -> assert_invited_wallet_can_list_and_report(Opts) end
        }
     || Opts <- listing_store_opts()
    ].

assert_invited_wallet_can_list_and_report(Opts) ->
    OwnerWallet = ar_wallet:new(),
    InvitedWallet = ar_wallet:new(),
    Owner = hb_util:human_id(ar_wallet:to_address(OwnerWallet)),
    Invited = hb_util:human_id(ar_wallet:to_address(InvitedWallet)),
    RegReq =
        signed_req(
            #{
                <<"name">> => <<"Docs">>,
                <<"users">> => Invited
            },
            OwnerWallet,
            Opts
        ),
    {ok, RegRes} = register(#{}, RegReq, Opts),
    Key = maps:get(<<"key">>, hb_json:decode(maps:get(<<"body">>, RegRes))),
    SitesReq = signed_req(#{}, InvitedWallet, Opts),
    {ok, SitesRes} = sites(#{}, SitesReq, Opts),
    SitesBody = hb_json:decode(maps:get(<<"body">>, SitesRes)),
    [Site] = maps:get(<<"sites">>, SitesBody),
    ?assertEqual(Owner, maps:get(<<"owner">>, Site)),
    ?assertEqual([Invited], maps:get(<<"users">>, Site)),
    ?assertEqual(Key, maps:get(<<"key">>, Site)),
    ReportReq = signed_req(#{ <<"key">> => Key, <<"days">> => <<"1">> }, InvitedWallet, Opts),
    {ok, ReportRes} = report(#{}, ReportReq, Opts),
    ?assertEqual(200, maps:get(<<"status">>, ReportRes)).

hash_route_page_is_sanitized_test() ->
    ?assertEqual(<<"/blocks">>, sanitize_page(<<"http://localhost:3000/#/blocks?tab=height">>)),
    ?assertEqual(<<"/docs">>, sanitize_page(<<"/#/docs">>)),
    ?assertEqual(<<"/console">>, sanitize_page(<<"#!/console?node=local">>)),
    %% Full paths are preserved (no collapsing) -- only the query string/hash
    %% and hash-route resolution are stripped.
    ?assertEqual(
        <<"/explorer/ke6qWZ4tMf-kSJ6X7fped0Au7_GUNBhu0zRGa16FyyY">>,
        sanitize_page(<<"/explorer/ke6qWZ4tMf-kSJ6X7fped0Au7_GUNBhu0zRGa16FyyY">>)
    ),
    ?assertEqual(<<"/explorer/abc">>, sanitize_page(<<"http://localhost:3000/#/explorer/abc?x=1">>)),
    ?assertEqual(<<"/">>, sanitize_page(<<"/">>)).

%% @doc Nested routes are no longer collapsed: two distinct pages under the
%% same top-level section are tracked (and reported) separately, so a
%% dashboard filter on the section can sum them, and a filter on one specific
%% post matches only that post. See `sanitize_page/1'.
nested_route_pages_tracked_distinctly_test() ->
    Opts = test_opts(),
    Wallet = ar_wallet:new(),
    RegReq = signed_req(#{ <<"name">> => <<"Blog">>, <<"origin">> => <<"https://example.com">> }, Wallet, Opts),
    {ok, RegRes} = register(#{}, RegReq, Opts),
    Key = maps:get(<<"key">>, hb_json:decode(maps:get(<<"body">>, RegRes))),
    Base = #{ <<"key">> => Key, <<"origin">> => <<"https://example.com">>, <<"event">> => <<"start">> },
    {ok, _} = session(#{}, Base#{ <<"visit">> => <<"v1">>, <<"page">> => <<"/blog/post-a">> }, Opts),
    {ok, _} = session(#{}, Base#{ <<"visit">> => <<"v2">>, <<"page">> => <<"/blog/post-b">> }, Opts),
    ReportReq = signed_req(#{ <<"key">> => Key, <<"days">> => <<"1">> }, Wallet, Opts),
    {ok, ReportRes} = report(#{}, ReportReq, Opts),
    Pages = maps:get(<<"pages">>, hb_json:decode(maps:get(<<"body">>, ReportRes))),
    PagePaths = lists:sort([maps:get(<<"page">>, P) || P <- Pages]),
    ?assertEqual([<<"/blog/post-a">>, <<"/blog/post-b">>], PagePaths),
    ?assert(page_matches_route(<<"/blog/post-a">>, <<"/blog">>)),
    ?assert(page_matches_route(<<"/blog/post-b">>, <<"/blog">>)),
    ?assertNot(page_matches_route(<<"/blog/post-b">>, <<"/blog/post-a">>)).

page_loads_preserve_repeat_navigations_test() ->
    Opts = test_opts(),
    Wallet = ar_wallet:new(),
    {ok, RegRes} = register(#{}, signed_req(#{ <<"name">> => <<"Pages">> }, Wallet, Opts), Opts),
    Key = maps:get(<<"key">>, hb_json:decode(maps:get(<<"body">>, RegRes))),
    Base =
        #{
            <<"key">> => Key,
            <<"page">> => <<"/same-page">>,
            <<"event">> => <<"start">>,
            <<"remote-addr">> => <<"192.0.2.20">>,
            <<"user-agent">> => <<"same-browser">>
        },
    {ok, _} = session(#{}, Base#{ <<"visit">> => <<"visit-1">> }, Opts),
    {ok, _} = session(#{}, Base#{ <<"visit">> => <<"visit-2">> }, Opts),
    {ok, ReportRes} = report(#{}, signed_req(#{ <<"key">> => Key, <<"days">> => 1 }, Wallet, Opts), Opts),
    Report = hb_json:decode(maps:get(<<"body">>, ReportRes)),
    Summary = maps:get(<<"summary">>, Report),
    [Page] = maps:get(<<"pages">>, Report),
    ?assertEqual(2, maps:get(<<"page-loads">>, Summary)),
    ?assertEqual(1, maps:get(<<"visits">>, Summary)),
    ?assertEqual(2, maps:get(<<"page-loads">>, Page)),
    ?assertEqual(1, maps:get(<<"visits">>, Page)).

sites_lists_registered_site_test_() ->
    [
        {
            "sites/3 lists a registered site (" ++ atom_to_list(store_module(Opts)) ++ ")",
            fun() -> assert_sites_lists_registered_site(Opts) end
        }
     || Opts <- listing_store_opts()
    ].

assert_sites_lists_registered_site(Opts) ->
    Wallet = ar_wallet:new(),
    Owner = hb_util:human_id(ar_wallet:to_address(Wallet)),
    RegReq = signed_req(#{ <<"name">> => <<"Docs">> }, Wallet, Opts),
    {ok, RegRes} = register(#{}, RegReq, Opts),
    Key = maps:get(<<"key">>, hb_json:decode(maps:get(<<"body">>, RegRes))),
    SitesReq = signed_req(#{ <<"name">> => <<"Docs">> }, Wallet, Opts),
    {ok, SitesRes} = sites(#{}, SitesReq, Opts),
    Body = hb_json:decode(maps:get(<<"body">>, SitesRes)),
    ?assertEqual(Owner, maps:get(<<"owner">>, Body)),
    Sites = maps:get(<<"sites">>, Body),
    ?assertEqual(1, length(Sites)),
    [Site] = Sites,
    ?assertEqual(Key, maps:get(<<"key">>, Site)),
    ?assertEqual(<<"Docs">>, maps:get(<<"name">>, Site)).

sites_self_heals_legacy_index_test_() ->
    [
        {
            "sites/3 recovers an index entry written without a group marker ("
                ++ atom_to_list(store_module(Opts)) ++ ")",
            fun() -> assert_sites_self_heals_legacy_index(Opts) end
        }
     || Opts <- listing_store_opts()
    ].

%% Reproduces the exact state an earlier build left in a persistent store: the
%% site record and the owner index leaf were written, but no group marker was
%% created at the owner path. sites/3 must still surface the site.
assert_sites_self_heals_legacy_index(Opts) ->
    Wallet = ar_wallet:new(),
    Owner = hb_util:human_id(ar_wallet:to_address(Wallet)),
    Key = <<"legacykey00000000000000000000000000000000AA">>,
    Now = now_ms(),
    Site = site_record(undefined, Key, Owner, #{ <<"name">> => <<"Legacy">> }, Now, Opts),
    ok = write_json(site_path(Key, Opts), Site, Opts),
    ok = hb_store:write(#{ owner_site_path(Owner, Key, Opts) => Key }, Opts),
    SitesReq = signed_req(#{ <<"name">> => <<"Legacy">> }, Wallet, Opts),
    {ok, SitesRes} = sites(#{}, SitesReq, Opts),
    Body = hb_json:decode(maps:get(<<"body">>, SitesRes)),
    Sites = maps:get(<<"sites">>, Body),
    ?assertEqual(1, length(Sites)),
    [Found] = Sites,
    ?assertEqual(Key, maps:get(<<"key">>, Found)),
    ?assertEqual(<<"Legacy">>, maps:get(<<"name">>, Found)).

active_visits_counted_test_() ->
    [
        {
            "report active count reflects a live visit (" ++ atom_to_list(store_module(Opts)) ++ ")",
            fun() -> assert_active_visits_counted(Opts) end
        }
     || Opts <- listing_store_opts()
    ].

assert_active_visits_counted(Opts) ->
    Wallet = ar_wallet:new(),
    RegReq =
        signed_req(
            #{ <<"name">> => <<"Docs">>, <<"origin">> => <<"https://example.com">> },
            Wallet,
            Opts
        ),
    {ok, RegRes} = register(#{}, RegReq, Opts),
    Key = maps:get(<<"key">>, hb_json:decode(maps:get(<<"body">>, RegRes))),
    {ok, _} =
        session(
            #{},
            #{
                <<"key">> => Key,
                <<"visit">> => <<"visit-1">>,
                <<"page">> => <<"/">>,
                <<"event">> => <<"start">>,
                <<"origin">> => <<"https://example.com">>
            },
            Opts
        ),
    ReportReq = signed_req(#{ <<"key">> => Key, <<"days">> => <<"1">> }, Wallet, Opts),
    {ok, ReportRes} = report(#{}, ReportReq, Opts),
    Summary = maps:get(<<"summary">>, hb_json:decode(maps:get(<<"body">>, ReportRes))),
    ?assertEqual(1, maps:get(<<"active">>, Summary)).

acquisition_technology_and_events_test() ->
    Opts = test_opts(),
    Wallet = ar_wallet:new(),
    RegReq =
        signed_req(
            #{ <<"name">> => <<"Docs">>, <<"origin">> => <<"https://example.com">> },
            Wallet,
            Opts
        ),
    {ok, RegRes} = register(#{}, RegReq, Opts),
    Key = maps:get(<<"key">>, hb_json:decode(maps:get(<<"body">>, RegRes))),
    UA =
        <<"Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 "
          "(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1">>,
    Base =
        #{
            <<"key">> => Key,
            <<"origin">> => <<"https://example.com">>,
            <<"x-forwarded-for">> => <<"203.0.113.10">>,
            <<"user-agent">> => UA,
            <<"referrer">> => <<"https://www.google.com/search?q=x">>,
            <<"utm_source">> => <<"newsletter">>,
            <<"utm_medium">> => <<"email">>,
            <<"utm_campaign">> => <<"launch">>,
            <<"language">> => <<"en-US,en;q=0.9">>
        },
    %% First page-view: new visitor, opens a session (bounce so far) landing on "/".
    {ok, _} =
        session(
            #{},
            Base#{ <<"visit">> => <<"v1">>, <<"page">> => <<"/">>, <<"event">> => <<"start">>, <<"duration">> => <<"0">> },
            Opts
        ),
    %% Second page-view from the same visitor (same IP+UA): continues the session,
    %% so it is no longer a bounce and the exit page moves to "/pricing".
    {ok, _} =
        session(
            #{},
            Base#{
                <<"visit">> => <<"v2">>,
                <<"page">> => <<"/pricing">>,
                <<"event">> => <<"start">>,
                <<"duration">> => <<"5000">>
            },
            Opts
        ),
    %% A custom conversion event.
    {ok, _} = event(#{}, Base#{ <<"name">> => <<"Signup">> }, Opts),
    ReportReq = signed_req(#{ <<"key">> => Key, <<"days">> => <<"1">> }, Wallet, Opts),
    {ok, ReportRes} = report(#{}, ReportReq, Opts),
    Report = hb_json:decode(maps:get(<<"body">>, ReportRes)),
    Summary = maps:get(<<"summary">>, Report),
    Acq = maps:get(<<"acquisition">>, Report),
    Tech = maps:get(<<"technology">>, Report),
    Nav = maps:get(<<"navigation">>, Report),
    Events = maps:get(<<"events">>, Report),
    %% Traffic + engagement.
    ?assertEqual(2, maps:get(<<"visits">>, Summary)),
    ?assertEqual(1, maps:get(<<"unique-visitors">>, Summary)),
    ?assertEqual(1, maps:get(<<"sessions">>, Summary)),
    ?assertEqual(0, maps:get(<<"bounces">>, Summary)),
    %% Acquisition.
    [Ref] = maps:get(<<"referrers">>, Acq),
    ?assertEqual(<<"google.com">>, maps:get(<<"referrer">>, Ref)),
    [Src] = maps:get(<<"utm-sources">>, Acq),
    ?assertEqual(<<"newsletter">>, maps:get(<<"utm-source">>, Src)),
    %% Technology / audience.
    [Dev] = maps:get(<<"devices">>, Tech),
    ?assertEqual(<<"Mobile">>, maps:get(<<"device">>, Dev)),
    [Br] = maps:get(<<"browsers">>, Tech),
    ?assertEqual(<<"Safari">>, maps:get(<<"browser">>, Br)),
    [OS] = maps:get(<<"operating-systems">>, Tech),
    ?assertEqual(<<"iOS">>, maps:get(<<"os">>, OS)),
    [Lang] = maps:get(<<"languages">>, Tech),
    ?assertEqual(<<"en">>, maps:get(<<"language">>, Lang)),
    %% Navigation: landing on "/", exit on "/pricing".
    [Landing] = maps:get(<<"landing-pages">>, Nav),
    ?assertEqual(<<"/">>, maps:get(<<"page">>, Landing)),
    ?assertEqual(1, maps:get(<<"sessions">>, Landing)),
    [Exit] = maps:get(<<"exit-pages">>, Nav),
    ?assertEqual(<<"/pricing">>, maps:get(<<"page">>, Exit)),
    %% Events + conversion (1 event / 1 session = 1.0).
    [Ev] = Events,
    ?assertEqual(<<"Signup">>, maps:get(<<"name">>, Ev)),
    ?assertEqual(1, maps:get(<<"count">>, Ev)),
    ?assertEqual(1.0, maps:get(<<"conversion-rate">>, Ev)).

bounce_counts_single_page_session_test() ->
    Opts = test_opts(),
    Wallet = ar_wallet:new(),
    RegReq = signed_req(#{ <<"name">> => <<"Docs">>, <<"origin">> => <<"https://example.com">> }, Wallet, Opts),
    {ok, RegRes} = register(#{}, RegReq, Opts),
    Key = maps:get(<<"key">>, hb_json:decode(maps:get(<<"body">>, RegRes))),
    {ok, _} =
        session(
            #{},
            #{
                <<"key">> => Key,
                <<"origin">> => <<"https://example.com">>,
                <<"x-forwarded-for">> => <<"203.0.113.99">>,
                <<"user-agent">> => <<"Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537.36">>,
                <<"visit">> => <<"v1">>,
                <<"page">> => <<"/">>,
                <<"event">> => <<"start">>
            },
            Opts
        ),
    ReportReq = signed_req(#{ <<"key">> => Key, <<"days">> => <<"1">> }, Wallet, Opts),
    {ok, ReportRes} = report(#{}, ReportReq, Opts),
    Summary = maps:get(<<"summary">>, hb_json:decode(maps:get(<<"body">>, ReportRes))),
    ?assertEqual(1, maps:get(<<"sessions">>, Summary)),
    ?assertEqual(1, maps:get(<<"bounces">>, Summary)),
    ?assertEqual(1.0, maps:get(<<"bounce-rate">>, Summary)),
    %% The single page's own `pages[]' entry should carry the same
    %% session/bounce attribution as the site-wide summary.
    ReportReq2 = signed_req(#{ <<"key">> => Key, <<"days">> => <<"1">> }, Wallet, Opts),
    {ok, ReportRes2} = report(#{}, ReportReq2, Opts),
    Pages = maps:get(<<"pages">>, hb_json:decode(maps:get(<<"body">>, ReportRes2))),
    [Root] = [P || P <- Pages, maps:get(<<"page">>, P) =:= <<"/">>],
    ?assertEqual(1, maps:get(<<"sessions">>, Root)),
    ?assertEqual(1, maps:get(<<"bounces">>, Root)).

%% @doc A session spanning two pages should attribute `sessions' to both
%% pages it touched, but the tentative bounce opened on the entry page must
%% be reversed there (not on the second page) once the session's second
%% pageview arrives -- exercising `apply_page_session_counters/3'.
page_scoped_sessions_and_bounces_test() ->
    Opts = test_opts(),
    Wallet = ar_wallet:new(),
    RegReq = signed_req(#{ <<"name">> => <<"Docs">>, <<"origin">> => <<"https://example.com">> }, Wallet, Opts),
    {ok, RegRes} = register(#{}, RegReq, Opts),
    Key = maps:get(<<"key">>, hb_json:decode(maps:get(<<"body">>, RegRes))),
    Base =
        #{
            <<"key">> => Key,
            <<"origin">> => <<"https://example.com">>,
            <<"x-forwarded-for">> => <<"203.0.113.11">>,
            <<"user-agent">> => <<"Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537.36">>,
            <<"event">> => <<"start">>
        },
    %% Landing page-view: opens the session, tentatively a bounce on "/".
    {ok, _} = session(#{}, Base#{ <<"visit">> => <<"v1">>, <<"page">> => <<"/">> }, Opts),
    %% A second, distinct page within the same session: no longer a bounce,
    %% and "/pricing" becomes session-new too.
    {ok, _} = session(#{}, Base#{ <<"visit">> => <<"v2">>, <<"page">> => <<"/pricing">> }, Opts),
    ReportReq = signed_req(#{ <<"key">> => Key, <<"days">> => <<"1">> }, Wallet, Opts),
    {ok, ReportRes} = report(#{}, ReportReq, Opts),
    Report = hb_json:decode(maps:get(<<"body">>, ReportRes)),
    Pages = maps:get(<<"pages">>, Report),
    [Root] = [P || P <- Pages, maps:get(<<"page">>, P) =:= <<"/">>],
    [Pricing] = [P || P <- Pages, maps:get(<<"page">>, P) =:= <<"/pricing">>],
    %% Both pages were touched by the one session.
    ?assertEqual(1, maps:get(<<"sessions">>, Root)),
    ?assertEqual(1, maps:get(<<"sessions">>, Pricing)),
    %% The bounce opened on "/" is reversed there, not on "/pricing".
    ?assertEqual(0, maps:get(<<"bounces">>, Root)),
    ?assertEqual(0, maps:get(<<"bounces">>, Pricing)),
    %% Each page's own demographics/technology are attributed independently.
    RootDevices = maps:get(<<"devices">>, maps:get(<<"technology">>, Root)),
    PricingDevices = maps:get(<<"devices">>, maps:get(<<"technology">>, Pricing)),
    ?assertEqual(1, length(RootDevices)),
    ?assertEqual(1, length(PricingDevices)),
    ?assertEqual(<<"Desktop">>, maps:get(<<"device">>, hd(RootDevices))).

%% @doc An event sent with a `page' is attributed to that page's `events'
%% list (and only that page); one sent without (an older cached tracker
%% script) still counts site-wide but isn't attributed to any page.
page_scoped_events_test() ->
    Opts = test_opts(),
    Wallet = ar_wallet:new(),
    RegReq = signed_req(#{ <<"name">> => <<"Docs">>, <<"origin">> => <<"https://example.com">> }, Wallet, Opts),
    {ok, RegRes} = register(#{}, RegReq, Opts),
    Key = maps:get(<<"key">>, hb_json:decode(maps:get(<<"body">>, RegRes))),
    Base = #{ <<"key">> => Key, <<"origin">> => <<"https://example.com">> },
    {ok, _} = event(#{}, Base#{ <<"name">> => <<"Impression">>, <<"page">> => <<"/pricing">>, <<"type">> => <<"event">> }, Opts),
    {ok, _} = event(#{}, Base#{ <<"name">> => <<"Play">>, <<"page">> => <<"/pricing">>, <<"type">> => <<"action">> }, Opts),
    {ok, _} = event(#{}, Base#{ <<"name">> => <<"Newsletter">> }, Opts),
    ReportReq = signed_req(#{ <<"key">> => Key, <<"days">> => <<"1">> }, Wallet, Opts),
    {ok, ReportRes} = report(#{}, ReportReq, Opts),
    Report = hb_json:decode(maps:get(<<"body">>, ReportRes)),
    %% Site-wide: both events count.
    [SiteEvent] = [Ev || Ev <- maps:get(<<"events">>, Report), maps:get(<<"name">>, Ev) =:= <<"Play">>],
    ?assertEqual(1, maps:get(<<"count">>, SiteEvent)),
    ?assertEqual(3, maps:get(<<"events">>, maps:get(<<"summary">>, Report))),
    %% Actions are an explicit projection of action-typed events. Passive
    %% impressions remain in Events and never appear in Actions.
    [Action] = maps:get(<<"actions">>, Report),
    ?assertEqual(<<"Play">>, maps:get(<<"name">>, Action)),
    ?assertEqual(1, maps:get(<<"count">>, Action)),
    %% Per-page: only events sent with a page are attributed to it.
    Pages = maps:get(<<"pages">>, Report),
    [Pricing] = [P || P <- Pages, maps:get(<<"page">>, P) =:= <<"/pricing">>],
    PricingEvents = maps:get(<<"events">>, Pricing),
    ?assertEqual(2, length(PricingEvents)),
    [PricingAction] = maps:get(<<"actions">>, Pricing),
    ?assertEqual(<<"Play">>, maps:get(<<"name">>, PricingAction)),
    ?assertEqual(1, maps:get(<<"count">>, PricingAction)).

%% @doc The realtime Active Visitors count, scoped to a page filter, only
%% counts open tabs whose current page matches the route -- exact match or a
%% descendant, per `page_matches_route/2'.
active_visits_route_filter_test_() ->
    [
        {
            "active visitors count is scoped to a page filter (" ++ atom_to_list(store_module(Opts)) ++ ")",
            fun() -> assert_active_visits_route_filter(Opts) end
        }
     || Opts <- listing_store_opts()
    ].

assert_active_visits_route_filter(Opts) ->
    Wallet = ar_wallet:new(),
    RegReq = signed_req(#{ <<"name">> => <<"Docs">>, <<"origin">> => <<"https://example.com">> }, Wallet, Opts),
    {ok, RegRes} = register(#{}, RegReq, Opts),
    Key = maps:get(<<"key">>, hb_json:decode(maps:get(<<"body">>, RegRes))),
    Base =
        #{
            <<"key">> => Key,
            <<"origin">> => <<"https://example.com">>,
            <<"event">> => <<"start">>
        },
    {ok, _} = session(#{}, Base#{ <<"visit">> => <<"visit-blog">>, <<"page">> => <<"/blog">> }, Opts),
    {ok, _} = session(#{}, Base#{ <<"visit">> => <<"visit-about">>, <<"page">> => <<"/about">> }, Opts),
    UnfilteredReq = signed_req(#{ <<"key">> => Key, <<"days">> => <<"1">> }, Wallet, Opts),
    {ok, UnfilteredRes} = report(#{}, UnfilteredReq, Opts),
    UnfilteredSummary = maps:get(<<"summary">>, hb_json:decode(maps:get(<<"body">>, UnfilteredRes))),
    ?assertEqual(2, maps:get(<<"active">>, UnfilteredSummary)),
    FilteredReq = signed_req(#{ <<"key">> => Key, <<"days">> => <<"1">>, <<"page">> => <<"/blog">> }, Wallet, Opts),
    {ok, FilteredRes} = report(#{}, FilteredReq, Opts),
    FilteredSummary = maps:get(<<"summary">>, hb_json:decode(maps:get(<<"body">>, FilteredRes))),
    ?assertEqual(1, maps:get(<<"active">>, FilteredSummary)).

%% @doc Unit coverage for the route-matching helper shared by the realtime
%% Active Visitors filter (server-side) and the dashboard's own
%% `pageMatchesRoute' (client-side, frontend/src/views/Dashboard/analytics.ts):
%% exact match, descendant match, non-match, case-insensitivity, and an
%% empty/unset route matching everything.
page_matches_route_test() ->
    ?assert(page_matches_route(<<"/blog">>, <<"/blog">>)),
    ?assert(page_matches_route(<<"/blog/post">>, <<"/blog">>)),
    ?assertNot(page_matches_route(<<"/blogger">>, <<"/blog">>)),
    ?assertNot(page_matches_route(<<"/about">>, <<"/blog">>)),
    ?assert(page_matches_route(<<"/Blog">>, <<"/blog">>)),
    ?assert(page_matches_route(<<"/anything">>, undefined)),
    ?assert(page_matches_route(<<"/anything">>, <<>>)).

%% @doc `pages_from_days/1' must not crash on a legacy-shaped `by-path' entry
%% recorded before the per-page sessions/bounces/dimension fields existed --
%% `normalize_page_stats/1' backfills them to zero/empty, no migration
%% needed. See daily_default/1, normalize_daily/2.
pages_from_days_backfills_legacy_records_test() ->
    LegacyDay =
        #{
            <<"by-path">> =>
                #{
                    <<"/legacy">> =>
                        #{ <<"visits">> => 3, <<"duration-ms">> => 900, <<"max-duration-ms">> => 400 }
                }
        },
    [Page] = pages_from_days([LegacyDay]),
    ?assertEqual(<<"/legacy">>, maps:get(<<"page">>, Page)),
    ?assertEqual(3, maps:get(<<"visits">>, Page)),
    ?assertEqual(0, maps:get(<<"sessions">>, Page)),
    ?assertEqual(0, maps:get(<<"bounces">>, Page)),
    ?assertEqual([], maps:get(<<"ips">>, maps:get(<<"demographics">>, Page))),
    ?assertEqual([], maps:get(<<"events">>, Page)).

origin_allowed_ignores_path_and_fragment_test() ->
    Opts = test_opts(),
    %% Registered as a full URL incl. fragment (e.g. copied from a hash router).
    Site = #{ <<"origins">> => [<<"https://lunar.example.com/#">>] },
    Allow = fun(Origin) -> origin_allowed(Site, #{ <<"origin">> => Origin }, Opts) end,
    %% The browser always sends a bare origin; it must match the stored URL.
    ?assert(Allow(<<"https://lunar.example.com">>)),
    %% A path/fragment on either side is ignored.
    ?assert(Allow(<<"https://lunar.example.com/dashboard">>)),
    %% A genuinely different host is still rejected.
    ?assertNot(Allow(<<"https://evil.example.com">>)),
    %% A different scheme/port is still rejected.
    ?assertNot(Allow(<<"http://lunar.example.com">>)),
    %% No registered origins = allow all (unchanged).
    ?assert(origin_allowed(#{ <<"origins">> => [] }, #{ <<"origin">> => <<"https://x.y">> }, Opts)).

self_origin_referrer_is_direct_test() ->
    Opts = test_opts(),
    Wallet = ar_wallet:new(),
    RegReq =
        signed_req(
            #{ <<"name">> => <<"Docs">>, <<"origin">> => <<"https://os.example.com">> },
            Wallet,
            Opts
        ),
    {ok, RegRes} = register(#{}, RegReq, Opts),
    Key = maps:get(<<"key">>, hb_json:decode(maps:get(<<"body">>, RegRes))),
    Track =
        fun(Referrer) ->
            {ok, _} =
                session(
                    #{},
                    #{
                        <<"key">> => Key,
                        <<"origin">> => <<"https://os.example.com">>,
                        <<"referrer">> => Referrer,
                        <<"visit">> => <<"v1">>,
                        <<"page">> => <<"/create">>,
                        <<"event">> => <<"start">>
                    },
                    Opts
                )
        end,
    %% Internal navigation (referrer host == site host, even with www + path).
    Track(<<"https://www.os.example.com/dashboard">>),
    %% A genuine external referrer is still recorded.
    Track(<<"https://t.co/abc">>),
    ReportReq = signed_req(#{ <<"key">> => Key, <<"days">> => <<"1">> }, Wallet, Opts),
    {ok, ReportRes} = report(#{}, ReportReq, Opts),
    Acq = maps:get(<<"acquisition">>, hb_json:decode(maps:get(<<"body">>, ReportRes))),
    Referrers = maps:get(<<"referrers">>, Acq),
    Hosts = [maps:get(<<"referrer">>, R) || R <- Referrers],
    ?assert(lists:member(<<"Direct">>, Hosts)),
    ?assert(lists:member(<<"t.co">>, Hosts)),
    ?assertNot(lists:member(<<"os.example.com">>, Hosts)).

ended_visit_is_not_active_test() ->
    Opts = test_opts(),
    Wallet = ar_wallet:new(),
    RegReq =
        signed_req(
            #{ <<"name">> => <<"Docs">>, <<"origin">> => <<"https://example.com">> },
            Wallet,
            Opts
        ),
    {ok, RegRes} = register(#{}, RegReq, Opts),
    Key = maps:get(<<"key">>, hb_json:decode(maps:get(<<"body">>, RegRes))),
    Ping =
        fun(Event) ->
            {ok, _} =
                session(
                    #{},
                    #{
                        <<"key">> => Key,
                        <<"visit">> => <<"visit-1">>,
                        <<"page">> => <<"/">>,
                        <<"event">> => Event,
                        <<"origin">> => <<"https://example.com">>
                    },
                    Opts
                )
        end,
    Active =
        fun() ->
            ReportReq = signed_req(#{ <<"key">> => Key, <<"days">> => <<"1">> }, Wallet, Opts),
            {ok, ReportRes} = report(#{}, ReportReq, Opts),
            Summary = maps:get(<<"summary">>, hb_json:decode(maps:get(<<"body">>, ReportRes))),
            maps:get(<<"active">>, Summary)
        end,
    Ping(<<"start">>),
    ?assertEqual(1, Active()),
    %% A tab close pings `end'; the visit must drop out of the active count even
    %% though the `end' ping refreshed `last-seen' to now.
    Ping(<<"end">>),
    ?assertEqual(0, Active()).

client_ip_falls_back_to_connection_ip_test() ->
    Opts = test_opts(),
    %% No proxy IP header: HyperBEAM stashes the resolved connection address
    %% (x-real-ip or the raw socket peer) in the message's private `ip'.
    Direct = hb_private:set(#{}, <<"ip">>, <<"198.51.100.7">>, Opts),
    ?assertEqual(<<"198.51.100.7">>, client_ip(Direct, Opts)),
    %% A proxy/CDN IP header still wins over the connection fallback.
    Proxied =
        hb_private:set(
            #{ <<"x-forwarded-for">> => <<"203.0.113.10, 70.0.0.1">> },
            <<"ip">>,
            <<"198.51.100.7">>,
            Opts
        ),
    ?assertEqual(<<"203.0.113.10">>, client_ip(Proxied, Opts)),
    %% Nothing available at all stays "unknown".
    ?assertEqual(<<"unknown">>, client_ip(#{}, Opts)).

persistent_visitors_and_engaged_sessions_test() ->
    Opts =
        (test_opts())#{
            <<"analytics-sites">> =>
                [
                    #{
                        <<"key">> => <<"persistent-site">>,
                        <<"name">> => <<"Persistent">>,
                        <<"origins">> => [],
                        <<"visitor-id-mode">> => <<"persistent">>
                    }
                ]
        },
    Base =
        #{
            <<"key">> => <<"persistent-site">>,
            <<"visitor-id">> => <<"browser-random-id">>,
            <<"user-agent">> => <<"analytics-test">>,
            <<"remote-addr">> => <<"192.0.2.10">>,
            <<"page">> => <<"/video">>
        },
    {ok, _} = session(#{}, Base#{ <<"visit">> => <<"visit-1">>, <<"event">> => <<"start">> }, Opts),
    {ok, _} =
        session(
            #{},
            Base#{
                <<"visit">> => <<"visit-1">>,
                <<"event">> => <<"heartbeat">>,
                <<"duration">> => ?ENGAGED_SESSION_MS
            },
            Opts
        ),
    {ok, _} = session(#{}, Base#{ <<"visit">> => <<"visit-2">>, <<"page">> => <<"/about">> }, Opts),
    Daily = normalize_daily(today(), read_json(daily_path(<<"persistent-site">>, today(), Opts), #{}, Opts)),
    ?assertEqual(1, maps:get(<<"active-users">>, Daily)),
    ?assertEqual(1, maps:get(<<"new-users">>, Daily)),
    ?assertEqual(1, maps:get(<<"engaged-sessions">>, Daily)),
    ?assertEqual(1, map_size(maps:get(<<"stable-visitors">>, Daily))),
    FirstDirect = maps:get(<<"Direct">>, maps:get(<<"by-first-referrer">>, Daily)),
    ?assertEqual(1, maps:get(<<"users">>, FirstDirect)),
    SessionDirect = maps:get(<<"Direct">>, maps:get(<<"by-session-referrer">>, Daily)),
    ?assertEqual(1, maps:get(<<"sessions">>, SessionDirect)),
    ?assertEqual(1, maps:get(<<"engaged-sessions">>, SessionDirect)),
    ?assertEqual(?ENGAGED_SESSION_MS, maps:get(<<"duration-ms">>, SessionDirect)),
    Acquisition = acquisition_from_days([Daily]),
    FirstTouch = maps:get(<<"first-touch">>, Acquisition),
    [FirstReferrer] = maps:get(<<"referrers">>, FirstTouch),
    ?assertEqual(<<"Direct">>, maps:get(<<"referrer">>, FirstReferrer)),
    ?assertEqual(1, maps:get(<<"users">>, FirstReferrer)),
    Audience = audience_from_days([Daily]),
    Breakdowns = maps:get(<<"breakdowns">>, Audience),
    [Desktop] = maps:get(<<"devices">>, Breakdowns),
    ?assertEqual(<<"Desktop">>, maps:get(<<"device">>, Desktop)),
    ?assertEqual(1, maps:get(<<"active-users">>, Desktop)),
    PublicDaily = public_daily(Daily),
    ?assertNot(maps:is_key(<<"stable-visitors">>, PublicDaily)),
    ?assertNot(maps:is_key(<<"stable-visitor-dimensions">>, PublicDaily)).

audience_and_retention_aggregate_test() ->
    Day1 =
        (daily_default(<<"2026-08-01">>))#{
            <<"unique-visitors">> => 3,
            <<"stable-visitors">> =>
                #{
                    <<"a">> => <<"2026-08-01">>,
                    <<"b">> => <<"2026-08-01">>,
                    <<"returning">> => <<"2026-07-01">>
                }
        },
    Day2 =
        (daily_default(<<"2026-08-02">>))#{
            <<"unique-visitors">> => 2,
            <<"stable-visitors">> =>
                #{ <<"a">> => <<"2026-08-01">>, <<"c">> => <<"2026-08-02">> }
        },
    Day8 =
        (daily_default(<<"2026-08-08">>))#{
            <<"unique-visitors">> => 2,
            <<"stable-visitors">> =>
                #{ <<"a">> => <<"2026-08-01">>, <<"b">> => <<"2026-08-01">> }
        },
    Daily = [Day1, Day2, Day8],
    Audience = audience_from_days(Daily),
    ?assertEqual(4, maps:get(<<"active-users">>, Audience)),
    ?assertEqual(3, maps:get(<<"new-users">>, Audience)),
    ?assertEqual(1, maps:get(<<"returning-users">>, Audience)),
    Retention = retention_from_days(Daily),
    [Cohort | _] = maps:get(<<"cohorts">>, Retention),
    ?assertEqual(<<"2026-08-01">>, maps:get(<<"cohort-date">>, Cohort)),
    ?assertEqual(2, maps:get(<<"new-users">>, Cohort)),
    [Day1Retention, Day7Retention | _] = maps:get(<<"retention">>, Cohort),
    ?assertEqual(1, maps:get(<<"active-users">>, Day1Retention)),
    ?assertEqual(0.5, maps:get(<<"retention-rate">>, Day1Retention)),
    ?assertEqual(2, maps:get(<<"active-users">>, Day7Retention)),
    ?assertEqual(1.0, maps:get(<<"retention-rate">>, Day7Retention)).

store_module(Opts) ->
    maps:get(<<"store-module">>, maps:get(<<"store">>, Opts)).

-endif.
