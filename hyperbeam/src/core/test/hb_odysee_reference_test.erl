%%% @doc Tests for the local, updatable reference device
%%% (`~odysee-reference@1.0'): the mutable "stable reference key -> current
%%% immutable id" layer.
%%%
%%% The load-bearing assertion is the IN-PLACE UPDATE that `~local-name@1.0'
%%% fails: `set(K -> A)' then `current(K)' => A, then `set(K -> B)' then
%%% `current(K)' => B. Because the device repoints the store link via
%%% `hb_cache:link' and reads fresh via `hb_cache:read' (no in-memory name
%%% cache), the second `set' is observed immediately.
%%%
%%% Offline: a fresh fs store, real wallets, an ephemeral-port node for the HTTP
%%% path, no network.
-module(hb_odysee_reference_test).
-include_lib("eunit/include/eunit.hrl").
-include("include/hb.hrl").

%% @doc A fresh, unclaimed-node Opts: a private fs store and no operator/wallet,
%% so the operator gate on `set' is permissive (matching `dev_local_name').
opts(Tag) ->
    #{ <<"store">> => [hb_test_utils:test_store(hb_store_fs, Tag)] }.

%% @doc Write an immutable target message carrying a distinguishing marker and
%% return its content id. The marker lets a later read assert WHICH target a
%% reference currently resolves to (a read-back materialises structure, so we
%% assert on a scalar leaf, not whole-message equality).
write_target(Marker, Opts) ->
    Msg = #{ <<"odysee-reference-target">> => Marker },
    {ok, Id} = hb_cache:write(Msg, Opts),
    Id.

%% @doc Resolve `current' for a reference key and return its marker leaf.
current_marker(Key, Opts) ->
    Base = #{ <<"device">> => <<"odysee-reference@1.0">>, <<"key">> => Key },
    case hb_ao:resolve(Base, <<"current">>, Opts) of
        {ok, Value} ->
            hb_ao:get(<<"odysee-reference-target">>, Value, not_found, Opts);
        Other ->
            Other
    end.

%% @doc Point reference `Key' at `Target' via the device's `point' key (the
%% meeting's "set"; named `point' because `set' is a reserved AO-Core verb -- see
%% the device's `point/3' note).
set_reference(Key, Target, Opts) ->
    Base =
        #{
            <<"device">> => <<"odysee-reference@1.0">>,
            <<"key">> => Key,
            <<"target">> => Target
        },
    hb_ao:resolve(Base, <<"point">>, Opts).

%% @doc The core requirement: set(K->A); current(K) => A; set(K->B); current(K)
%% => B. This is the in-place update that the in-memory `~local-name@1.0' cache
%% fails.
set_then_current_updates_in_place_test() ->
    Opts = opts(<<"ref-update">>),
    Key = <<"my-claim">>,
    TargetA = write_target(<<"target-A">>, Opts),
    TargetB = write_target(<<"target-B">>, Opts),
    ?assertNotEqual(TargetA, TargetB),
    % set(K -> A); current(K) => A
    ?assertMatch({ok, #{ <<"status">> := 200 }}, set_reference(Key, TargetA, Opts)),
    ?assertEqual(<<"target-A">>, current_marker(Key, Opts)),
    % set(K -> B); current(K) => B  (the update local-name cannot do)
    ?assertMatch({ok, #{ <<"status">> := 200 }}, set_reference(Key, TargetB, Opts)),
    ?assertEqual(<<"target-B">>, current_marker(Key, Opts)).

%% @doc `set' echoes back the key and the target it now resolves to.
set_returns_key_and_target_test() ->
    Opts = opts(<<"ref-echo">>),
    Key = <<"echo-claim">>,
    Target = write_target(<<"echo">>, Opts),
    {ok, Resp} = set_reference(Key, Target, Opts),
    ?assertEqual(Key, hb_maps:get(<<"key">>, Resp, undefined, Opts)),
    ?assertEqual(Target, hb_maps:get(<<"target">>, Resp, undefined, Opts)).

%% @doc `resolve' is an alias for `current'.
resolve_aliases_current_test() ->
    Opts = opts(<<"ref-alias">>),
    Key = <<"alias-claim">>,
    Target = write_target(<<"alias-A">>, Opts),
    ?assertMatch({ok, _}, set_reference(Key, Target, Opts)),
    Base = #{ <<"device">> => <<"odysee-reference@1.0">>, <<"key">> => Key },
    {ok, Value} = hb_ao:resolve(Base, <<"resolve">>, Opts),
    ?assertEqual(
        <<"alias-A">>,
        hb_ao:get(<<"odysee-reference-target">>, Value, not_found, Opts)
    ).

%% @doc `current' for an unknown reference key is a 404. (Errors are carried as
%% `{ok, #{status => ...}}' -- see the device's `set/3' note on the reserved
%% `set' verb -- so the HTTP status maps correctly.)
current_unknown_key_is_not_found_test() ->
    Opts = opts(<<"ref-missing">>),
    Base = #{ <<"device">> => <<"odysee-reference@1.0">>, <<"key">> => <<"nope">> },
    ?assertMatch(
        {ok, #{ <<"status">> := 404 }},
        hb_ao:resolve(Base, <<"current">>, Opts)
    ).

%% @doc `point' without a target is a 400.
set_without_target_is_bad_request_test() ->
    Opts = opts(<<"ref-no-target">>),
    Base = #{ <<"device">> => <<"odysee-reference@1.0">>, <<"key">> => <<"k">> },
    ?assertMatch(
        {ok, #{ <<"status">> := 400 }},
        hb_ao:resolve(Base, <<"point">>, Opts)
    ).

%% @doc On a CLAIMED node (operator wallet configured), an UNSIGNED `point' is
%% rejected 403 -- the operator gate. A `point' signed by the operator passes and
%% performs the update. (This is exactly the operator-signature check that the
%% reserved `set' verb defeated by stripping the request's commitments, which is
%% why the key is `point'.)
set_is_operator_gated_test() ->
    Operator = ar_wallet:new(),
    Opts =
        (opts(<<"ref-gate">>))#{
            <<"priv-wallet">> => Operator,
            <<"operator">> => hb_util:human_id(ar_wallet:to_address(Operator))
        },
    Key = <<"gated-claim">>,
    Target = write_target(<<"gated">>, Opts),
    % Unsigned point -> rejected (403 carried as {ok, #{status => 403}}).
    Unsigned =
        #{
            <<"device">> => <<"odysee-reference@1.0">>,
            <<"key">> => Key,
            <<"target">> => Target
        },
    ?assertMatch(
        {ok, #{ <<"status">> := 403 }},
        hb_ao:resolve(Unsigned, <<"point">>, Opts)
    ),
    % Operator-signed point -> passes and updates.
    Signed =
        hb_message:commit(
            #{
                <<"device">> => <<"odysee-reference@1.0">>,
                <<"key">> => Key,
                <<"target">> => Target
            },
            Opts
        ),
    ?assertMatch(
        {ok, #{ <<"status">> := 200 }},
        hb_ao:resolve(Signed, <<"point">>, Opts)
    ),
    ?assertEqual(<<"gated">>, current_marker(Key, Opts)).

%% @doc The A-then-B update reflected over a real HTTP node: after each re-point,
%% a `current' READ over the wire returns the latest target. The re-point itself
%% is performed in-process (`set' is operator-gated AND collides with the
%% reserved `set' verb on the HTTP singleton path; the gate-over-HTTP and the
%% client-signing wallet are HTTP-infrastructure concerns, not the reference
%% logic -- the gated mutation is proven by `set_is_operator_gated_test' and the
%% A->B update by `set_then_current_updates_in_place_test'). The node disables
%% result caching for these mutable-at-constant-path reads (the documented
%% recipe) so `current' does not serve a cached prior target.
http_current_reflects_update_test() ->
    % One shared on-disk store, used for the node, the in-process re-points, and
    % the target writes, so the node can follow a reference link to a target's
    % bytes over the wire.
    Store = [hb_test_utils:test_store(hb_store_fs, <<"ref-http">>)],
    NodeOpts = #{ <<"store">> => Store },
    Node =
        hb_http_server:start_node(#{
            <<"port">> => 0,
            <<"store">> => Store,
            <<"http-extra-opts">> =>
                #{
                    <<"force-message">> => true,
                    <<"cache-control">> => [<<"no-store">>, <<"no-cache">>]
                }
        }),
    TargetA = write_target(<<"http-A">>, NodeOpts),
    TargetB = write_target(<<"http-B">>, NodeOpts),
    Key = <<"http-claim">>,
    % set(K -> A) in-process; current(K) over HTTP => A
    ?assertMatch({ok, #{ <<"status">> := 200 }}, set_reference(Key, TargetA, NodeOpts)),
    ?assertEqual(<<"http-A">>, http_current_marker(Node, Key, NodeOpts)),
    % set(K -> B) in-process; current(K) over HTTP => B (the in-place update,
    % now observed across the wire)
    ?assertMatch({ok, #{ <<"status">> := 200 }}, set_reference(Key, TargetB, NodeOpts)),
    ?assertEqual(<<"http-B">>, http_current_marker(Node, Key, NodeOpts)).

http_current_marker(Node, Key, NodeOpts) ->
    {ok, Value} =
        hb_http:get(Node, <<"/~odysee-reference@1.0/current?key=", Key/binary>>, NodeOpts),
    Loaded = hb_cache:ensure_all_loaded(Value, NodeOpts),
    hb_maps:get(<<"odysee-reference-target">>, Loaded, not_found, NodeOpts).

%% @doc The operator gate over REAL HTTP (the production entry point): on a
%% claimed node, a `point' POST signed by a NON-operator is rejected 403, while
%% one signed by the operator succeeds (200) and the update is observable via a
%% `current' read. Closes the auth-path coverage gap (the gate was otherwise only
%% exercised in-process; it rides the same is-operator-on-signed-body mechanism as
%% `dev_local_name:register', but the protected mutation deserves a direct
%% over-the-wire assertion).
point_over_http_is_operator_gated_test() ->
    Operator = ar_wallet:new(),
    Store = [hb_test_utils:test_store(hb_store_fs, <<"ref-http-gate">>)],
    Node =
        hb_http_server:start_node(#{
            <<"port">> => 0,
            <<"store">> => Store,
            <<"priv-wallet">> => Operator,
            <<"operator">> => hb_util:human_id(ar_wallet:to_address(Operator)),
            <<"http-extra-opts">> =>
                #{
                    <<"force-message">> => true,
                    <<"cache-control">> => [<<"no-store">>, <<"no-cache">>]
                }
        }),
    NodeOpts = #{ <<"store">> => Store },
    Key = <<"http-gated-claim">>,
    Target = write_target(<<"http-gate">>, NodeOpts),
    PointReq = #{ <<"key">> => Key, <<"target">> => Target },
    % Non-operator-signed point over the wire -> 403.
    NonOpOpts = NodeOpts#{ <<"priv-wallet">> => ar_wallet:new() },
    Forbidden =
        hb_http:post(
            Node,
            <<"/~odysee-reference@1.0/point">>,
            hb_message:commit(PointReq, NonOpOpts),
            NonOpOpts
        ),
    ?assertEqual(403, http_status(Forbidden)),
    % Operator-signed point over the wire -> 200, and `current' reflects it.
    OpOpts = NodeOpts#{ <<"priv-wallet">> => Operator },
    Allowed =
        hb_http:post(
            Node,
            <<"/~odysee-reference@1.0/point">>,
            hb_message:commit(PointReq, OpOpts),
            OpOpts
        ),
    ?assertEqual(200, http_status(Allowed)),
    ?assertEqual(<<"http-gate">>, http_current_marker(Node, Key, NodeOpts)).

%% @doc Pull the HTTP status from an hb_http response regardless of whether a
%% non-2xx surfaces as `{error, #{status}}' or `{ok, #{status}}'.
http_status({ok, M}) when is_map(M) -> hb_maps:get(<<"status">>, M, 200, #{});
http_status({error, M}) when is_map(M) -> hb_maps:get(<<"status">>, M, undefined, #{});
http_status(Other) -> Other.
