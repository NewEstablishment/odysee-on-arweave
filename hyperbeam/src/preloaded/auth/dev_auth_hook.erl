%%% @doc A device offering an on-request hook that signs incoming messages with
%%% node-hosted wallets, in accordance with the node operator's configuration.
%%% It is intended for deployment in environments where a node's users have
%%% intrinsic reasons for trusting the node outside of the scope of this device.
%%% For example, if executed on a node they operate or is operated by a trusted
%%% third-party.
%%% 
%%% This device utilizes the `generator' interface type which other devices may
%%% implement. The generator is used to find/create a secret based on a user's
%%% request, which is then passed to the `~proxy-wallet@1.0' device and matched
%%% with a wallet which is used to sign the request. The `generator' interface
%%% may implement the following keys:
%%% 
%%% <pre>
%%%     `generate' (optional): A key that generates a secret based on a
%%%                            user's request. May return either the secret
%%%                            directly, or a message with a `secret' key. If 
%%%                            a message is returned, it is assumed to be a
%%%                            modified version of the user's request and is
%%%                            used for further processing.
%%%     `finalize' (optional): A key that takes the message sequence after this
%%%                            device has processed it and returns it in a
%%%                            modified form.
%%% </pre>
%%% 
%%% At present, the `~cookie-secret@1.0' and `~http-auth@1.0' devices implement
%%% the `generator' interface. For example, the following hook definition will
%%% use the `~cookie-secret@1.0' device to generate and manage wallets for
%%% users, with authentication details stored in cookies:
%%% 
%%% <pre>
%%%   "on": {
%%%     "request": {
%%%       "device": "auth-hook@1.0",
%%%       "secret-provider": {
%%%         "device": "cookie-secret@1.0"
%%%       }
%%%     }
%%%   }
%%% </pre>
%%% 
%%% `~auth-hook@1.0' expects to receive a `secret-provider' key in the hook
%%% base message. It may optionally also take a `generate-path' and
%%% `finalize-path', which are used to generate the secret and post-process the
%%% response. If either `X-path' keys are not present, the `generate' and
%%% `finalize' paths are used upon the `secret-provider' message. If the secret
%%% provider's device does not implement these keys, the operations are skipped.
%%% 
%%% Node operators may also specify a `when' message inside their hook definition
%%% which is used to determine when messages should be signed. The supported keys
%%% are:
%%% 
%%% <pre>
%%%     `committers': always | uncommitted | [committer1, or committer2, or ...]
%%%     `keys': always | [key1, or key2, or ...]
%%% </pre>
%%% 
%%% Both keys are optional and can be combined to form 'and' conditions. For
%%% example, the following hook definition will sign all uncommitted requests
%%% that have the `Authorization' header:
%%% 
%%% <pre>
%%%   "on": {
%%%     "request": {
%%%       "device": "auth-hook@1.0",
%%%       "when": {
%%%             "keys": ["authorization"],
%%%             "committers": "uncommitted"
%%%         }
%%%       }
%%%     }
%%% </pre>
%%% 
-module(dev_auth_hook).
-export([request/3]).
-include("include/hb.hrl").
-include_lib("eunit/include/eunit.hrl").

%%% Default key used to indicate that an individual message in the path should
%%% be signed.
-define(DEFAULT_COMMIT_KEY, <<"!">>).

%%% Default keys to ignore when signing
-define(DEFAULT_IGNORED_KEYS,
    [
        <<"secret">>,
        <<"cookie">>,
        <<"set-cookie">>,
        <<"path">>,
        <<"method">>,
        <<"authorization">>,
        ?DEFAULT_COMMIT_KEY
    ]
).

%% @doc Process an incoming request through a key provider. The key provider
%% should be a message optionally implementing the following keys:
%% <pre>
%%     `generate-path': The path to call the `generate' function.
%%     `finalize-path': The path to call the `finalize' function.
%%     `skip-commit': Whether to skip committing the request.
%%     `ignored-keys': A list of keys to ignore when signing (can be overridden
%%     by the user request).
%% </pre>
%% 
request(Base, HookReq, Opts) ->
    ?event({auth_hook_request, {base, Base}, {priv_hook_req, HookReq}}),
    maybe
        % Get the key provider from options and short-circuit if none is
        % provided.
        {ok, Provider} ?= find_provider(Base, Opts),
        % Check if the request already has signatures, or the hook base enforces
        % that we should always attempt to sign the request.
        {ok, Request} ?= hb_maps:find(<<"request">>, HookReq, Opts),
        {ok, OrigMessages} ?= hb_maps:find(<<"body">>, HookReq, Opts),
        true ?= is_relevant(Base, Request, OrigMessages, Opts),
        ?event(auth_hook_is_relevant),
        % Call the key provider to normalize authentication (generate if needed)
        {ok, IntermediateProvider, NormReq} ?=
            generate_secret(Provider, Request, Opts),
        % Call `~secret@1.0' to generate a wallet if needed. Returns refreshed
        % options.
        {ok, NormProvider, NewOpts} ?=
            generate_wallet(IntermediateProvider, NormReq, Opts),
        ?event(
            {auth_hook_normalized,
                {priv_intermediate_provider, IntermediateProvider},
                {priv_norm_provider, NormProvider},
                {priv_norm_req, NormReq}
            }
        ),
        % Sign the full request  
        {ok, SignedReq} ?= sign_request(NormProvider, NormReq, NewOpts),
        ?event(auth_hook_signed),
        % Process individual messages if needed
        {ok, MessageSequence} ?=
            maybe_sign_messages(
                NormProvider,
                SignedReq,
                NewOpts
            ),
        {ok, StoredIDs} ?=
            maybe_store_signed([SignedReq | MessageSequence], NewOpts),
        ?event(auth_hook_processed_messages),
        % Call the key provider to finalize the response
        ExecutableSequence = executable_sequence(MessageSequence, NewOpts),
        {ok, FinalSequence} ?=
            finalize(
                NormProvider,
                SignedReq,
                ExecutableSequence,
                NewOpts
            ),
        ok ?= maybe_link_executable_result(
            MessageSequence,
            FinalSequence,
            StoredIDs,
            NewOpts
        ),
        ?event({auth_hook_returning, {priv_final_sequence, FinalSequence}}),
        {ok, #{ <<"body">> => FinalSequence, <<"request">> => SignedReq }}
    else
        {error, AuthError} ->
            ?event({auth_hook_auth_error, {priv_error, AuthError}}),
            {error, AuthError};
        {skip, {committers, Committers}, {keys, Keys}} ->
            ?event({auth_hook_skipping, {committers, Committers}, {keys, Keys}}),
            {ok, HookReq};
        error ->
            ?event({auth_hook_error, no_request}),
            {ok, HookReq};
        Other ->
            ?event({auth_hook_unexpected_result, Other}),
            Other
    end.

%% @doc Check if the request is relevant to the hook base. Node operators may
%% specify criteria for activation of the hook based on the committers of the
%% request (`always', `uncommitted', or a list of committers), or the presence
%% of certain keys (`always', or a list of keys) on any of the messages in the
%% sequence.
is_relevant(Base, Request, MessageSequence, Opts) ->
    Committers = is_relevant_from_committers(Base, Request, Opts),
    Keys =
        lists:any(
            fun(Msg) -> is_relevant_from_keys(Base, Msg, Opts) end,
            [Request | MessageSequence]
        ),
    ?event({auth_hook_is_relevant, {committers, Committers}, {keys, Keys}}),
    if Committers andalso Keys -> true;
        true -> {skip, {committers, Committers}, {keys, Keys}}
    end.

%% @doc Check if the request is relevant to the hook base based on the committers
%% of the request.
is_relevant_from_committers(Base, Request, Opts) ->
    Config =
        hb_util:deep_get(
            [<<"when">>, <<"committers">>],
            Base,
            <<"uncommitted">>,
            Opts
        ),
    ?event({auth_hook_is_relevant_from_committers, {config, Config}, {base, Base}}),
    case Config of
        <<"always">> -> true;
        <<"uncommitted">> -> hb_message:signers(Request, Opts) == [];
        RelevantCommitters ->
            lists:any(
                fun(Signer) ->
                    lists:member(Signer, RelevantCommitters)
                end,
                hb_message:signers(Request, Opts)
            )
    end.

%% @doc Check if the request is relevant to the hook base based on the presence
%% of keys specified in the hook base.
is_relevant_from_keys(_Base, ID, _Opts) when is_binary(ID) ->
    false;
is_relevant_from_keys(Base, {as, _, Msg}, Opts) ->
    is_relevant_from_keys(Base, Msg, Opts);
is_relevant_from_keys(Base, {resolve, Msg}, Opts) ->
    is_relevant_from_keys(Base, Msg, Opts);
is_relevant_from_keys(Base, Request, Opts) ->
    Config = hb_util:deep_get([<<"when">>, <<"keys">>], Base, <<"always">>, Opts),
    ?event(
        {
            auth_hook_is_relevant_from_keys,
            {config, Config},
            {base, Base},
            {priv_request, Request}
        }
    ),
    case Config of
        <<"always">> -> true;
        RelevantKeys ->
            lists:any(
                fun(Key) -> key_present(Key, Request, Opts) end,
                RelevantKeys
            )
    end.

%% @doc Check whether a `when.keys' entry is present on the request. A private
%% path (e.g. `priv/cookie') is resolved through `hb_private' so the gate can
%% match state the HTTP layer reshaped into the private element before the hook
%% ran (an inbound `cookie' header is stripped from the top level and stored
%% under `priv/cookie'); an empty private map counts as absent. A plain key is
%% matched at the top level. This lets a node gate on a browser cookie over the
%% wire while a request with neither the plain key nor a non-empty private
%% value still skips.
key_present(Key, Request, Opts) ->
    case hb_private:is_private(Key) of
        true ->
            case hb_private:get(Key, Request, not_found, Opts) of
                not_found -> false;
                Map when is_map(Map) -> hb_maps:size(Map, Opts) > 0;
                _ -> true
            end;
        false ->
            case hb_maps:find(Key, Request, Opts) of
                {ok, _} -> true;
                error -> false
            end
    end.

%% @doc Normalize authentication credentials, generating new ones if needed.
generate_secret(Provider, Request, Opts) ->
    case call_provider(<<"generate">>, Provider, Request, Opts) of
        {error, not_found} ->
            ?event({no_generate_handler, {priv_provider, Provider}}),
            {ok, Provider, strip_sensitive(Request, Opts)};
        {error, Err} ->
            % Forward the error. The main handler will fail to match this and
            % return the error to the user.
            ?event({generate_error, {priv_error, Err}}),
            {error, Err};
        {ok, Secret} when is_binary(Secret) ->
            % The provider returned a direct key, calculate the committer and
            % generate a wallet for it, if needed.
            ?event({priv_secret_from_provider, Secret}),
            {ok, Provider#{ <<"secret">> => Secret }, strip_sensitive(Request, Opts)};
        {ok, NormalizedReq} when is_map(NormalizedReq) ->
            % If there is a `wallet' field in the request, we move it to the
            % provider, else continue with the existing provider.
            ?event({priv_normalized_req, NormalizedReq}),
            case hb_maps:find(<<"secret">>, NormalizedReq, Opts) of
                {ok, Key} ->
                    ?event({priv_key_found_in_normalized_req, Key}),
                    {
                        ok,
                        Provider#{ <<"secret">> => Key },
                        strip_sensitive(NormalizedReq, Opts)
                    };
                error ->
                    ?event({no_key_in_normalized_req, {priv_normalized_req, NormalizedReq}}),
                    {ok, Provider, strip_sensitive(NormalizedReq, Opts)}
            end
    end.

%% @doc Strip the `secret' field from a request.
strip_sensitive(Request, Opts) ->
    hb_maps:without([<<"secret">>], Request, Opts).

%% @doc Generate a wallet with the key if the `wallet' field is not present in
%% the provider after normalization.
generate_wallet(Provider, Request, Opts) ->
    {ok, #{ <<"body">> := WalletID }} =
        hb_ao:raw(
            <<"secret@1.0">>,
            Provider,
            Request#{ <<"path">> => <<"generate">> },
            Opts
        ),
    ?event({generated_wallet, WalletID}),
    {ok, Provider, refresh_opts(Opts)}.

%% @doc Sign a request using the configured key provider
sign_request(Provider, Msg, Opts) ->
    case hb_maps:get(<<"skip-commit">>, Provider, true, Opts) of
        false ->
            % Skip signing and return the normalized message.
            ?event({provider_requested_signing_skip, {priv_provider, Provider}}),
            {ok, Msg};
        true ->
            % Wallet signs without ignored keys
            IgnoredKeys = ignored_keys(Msg, Opts),
            WithoutIgnored = hb_maps:without(IgnoredKeys, Msg, Opts),
            % Call the wallet to sign the request.
            case hb_ao:raw(
                <<"secret@1.0">>,
                WithoutIgnored,
                Provider#{ <<"path">> => <<"commit">> },
                Opts
            ) of
                {ok, Signed} ->
                    ?event({auth_hook_signed, Signed}),
                    SignedWithIgnored = 
                        hb_maps:merge(
                            Signed,
                            hb_maps:with(IgnoredKeys, Msg, Opts),
                            Opts
                        ),
                    {ok, SignedWithIgnored};
                {error, Err} ->
                    ?event({auth_hook_sign_error, Err}),
                    {error, Err}
            end
    end.

%% @doc Process a sequence of messages, signing those marked for signing
maybe_sign_messages(Provider, SignedReq, Opts) ->
    Parsed = hb_singleton:from(SignedReq, Opts),
    ?event({auth_hook_parsed_messages, {sequence_length, length(Parsed)}}),
    SignKey = hb_opts:get(auth_hook_commit_key, ?DEFAULT_COMMIT_KEY, Opts),
    Processed = maybe_sign_messages(Provider, SignKey, Parsed, Opts),
    {ok, Processed}.
maybe_sign_messages(_Provider, _Key, [], _Opts) -> [];
maybe_sign_messages(Provider, Key, [{as, Device, Msg} | Rest], Opts) when is_map(Msg) ->
    case hb_util:atom(hb_maps:get(Key, Msg, false, Opts)) of
        true ->
            Uncommitted = hb_message:uncommitted(Msg, Opts),
            ?event({auth_hook_signing_message, {priv_uncommitted, Msg}}),
            case sign_request(Provider, Uncommitted, Opts) of
                {ok, Signed} ->
                    [
                        {as, Device, Signed}
                    |
                        maybe_sign_messages(Provider, Key, Rest, Opts)
                    ];
                {error, Err} ->
                    ?event({auth_hook_sign_error, Err}),
                    [{error, Err}]
            end;
        _ ->
            [{as, Device, Msg} | maybe_sign_messages(Provider, Key, Rest, Opts)]
    end;
maybe_sign_messages(Provider, Key, [Msg | Rest], Opts) when is_map(Msg) ->
    case hb_util:atom(hb_maps:get(Key, Msg, false, Opts)) of
        true ->
            Uncommitted = hb_message:uncommitted(Msg, Opts),
            ?event({auth_hook_signing_message, {priv_uncommitted, Msg}}),
            case sign_request(Provider, Uncommitted, Opts) of
                {ok, Signed} ->
                    [
                        Signed
                    |
                        maybe_sign_messages(Provider, Key, Rest, Opts)
                    ];
                {error, Err} ->
                    ?event({auth_hook_sign_error, Err}),
                    [{error, Err}]
            end;
        _ ->
            [Msg | maybe_sign_messages(Provider, Key, Rest, Opts)]
    end;
maybe_sign_messages(Provider, Key, [Msg | Rest], Opts) ->
    [Msg | maybe_sign_messages(Provider, Key, Rest, Opts)].

executable_sequence([_Base, #{ <<"path">> := <<"id">> }] = Messages, Opts) ->
    resolve_executable_sequence(Messages, Opts);
%% `hb_singleton:maybe_inherit_message_id' parses `POST /id' with a binary body
%% into a single `{as, message@1.0, ...}' element rather than a two-element
%% sequence; without this clause the id is never pre-resolved for that shape
%% (e.g. the `~odysee-auth@1.0' provider path) and the response carries no id.
executable_sequence([{as, Dev, #{ <<"path">> := <<"id">> } = Msg}] = Messages, Opts) ->
    % `hb_singleton:maybe_inherit_message_id' collapses `POST /id' with a binary
    % body into a single `{as, message@1.0, Msg}' element. `hb_ao:resolve_many'
    % returns a one-element sequence verbatim (nothing applies the `id' path),
    % so the raw tuple would reach the encoder and be dropped from the response.
    % Re-split it into an explicit base + path step and resolve that instead.
    Base = {as, Dev, hb_maps:without([<<"path">>], Msg, Opts)},
    resolve_executable_sequence(
        [Base, #{ <<"path">> => <<"id">> }],
        Messages,
        Opts
    );
executable_sequence(Messages, _Opts) ->
    Messages.

resolve_executable_sequence(Messages, Opts) ->
    resolve_executable_sequence(Messages, Messages, Opts).
resolve_executable_sequence(Executable, Fallback, Opts) ->
    case hb_ao:resolve_many(Executable, Opts#{ <<"force-message">> => true }) of
        {ok, Res} -> [Res];
        _ -> Fallback
    end.

maybe_store_signed(Messages, Opts) ->
    case hb_opts:get(store_all_signed, false, Opts) of
        true -> store_signed(Messages, Opts);
        false -> {ok, []}
    end.

store_signed([], _Opts) ->
    {ok, []};
store_signed([{as, _Device, Msg} | Rest], Opts) when is_map(Msg) ->
    store_signed([Msg | Rest], Opts);
store_signed([Msg | Rest], Opts) when is_map(Msg) ->
    case hb_message:signers(Msg, Opts) of
        [] ->
            store_signed(Rest, Opts);
        _ ->
            {ok, ID} = hb_cache:write(Msg, signed_store_opts(Msg, Opts)),
            {ok, RestIDs} = store_signed(Rest, Opts),
            {ok, [ID | RestIDs]}
    end;
store_signed([_ | Rest], Opts) ->
    store_signed(Rest, Opts).

maybe_link_executable_result(Messages, FinalSequence, [StoredID | _], Opts) ->
    case {executable_id_request(Messages), final_result_id(FinalSequence)} of
        {true, {ok, ID}} ->
            hb_store:link(
                hb_opts:get(store, no_viable_store, Opts),
                #{ ID => StoredID },
                Opts
            ),
            ok;
        _ ->
            ok
    end;
maybe_link_executable_result(_Messages, _FinalSequence, _StoredIDs, _Opts) ->
    ok.

executable_id_request([_Base, #{ <<"path">> := <<"id">> }]) ->
    true;
executable_id_request([{as, _Dev, #{ <<"path">> := <<"id">> }}]) ->
    true;
executable_id_request(_) ->
    false.

final_result_id([ID | _]) when ?IS_ID(ID) ->
    {ok, ID};
final_result_id([#{ <<"body">> := ID } | _]) when ?IS_ID(ID) ->
    {ok, ID};
final_result_id([_ | Rest]) ->
    final_result_id(Rest);
final_result_id([]) ->
    error.

signed_store_opts(Msg, Opts) ->
    case hb_maps:get(<<"path">>, Msg, not_found, Opts) of
        <<"id">> -> Opts;
        _ -> Opts#{ <<"match-index">> => false }
    end.

%% @doc Finalize the response by adding authentication state
finalize(KeyProvider, SignedReq, MessageSequence, Opts) ->
    % Add the signed request and message sequence to the response, mirroring the
    % structure of a normal request hook.
    Req =
        #{
            <<"request">> => SignedReq,
            <<"body">> => MessageSequence
        },
    case call_provider(<<"finalize">>, KeyProvider, Req, Opts) of
        {ok, Finalized} ->
            ?event({auth_hook_finalized, {priv_finalized, Finalized}}),
            {ok, Finalized};
        {error, not_found} ->
            ?event(auth_hook_no_finalize_handler),
            {ok, MessageSequence}
    end.

%%% Utility functions

%% @doc Refresh the options and log an event if they have changed. Falls back
%% to the given options when no HTTP server is running (e.g. direct device
%% resolution in tests).
refresh_opts(Opts) ->
    NewOpts =
        case hb_opts:get(http_server, no_server_ref, Opts) of
            no_server_ref ->
                Opts;
            _ ->
                try merge_refreshed_opts(Opts, hb_http_server:get_opts(Opts))
                catch _:_ -> Opts
                end
        end,
    case NewOpts of
        Opts -> ?event(auth_hook_no_opts_change);
        _ ->
            ?event(
                {auth_hook_opts_changed,
                    {size_diff,
                        erlang:external_size(NewOpts) -
                            erlang:external_size(Opts)
                    }
                }
            )
    end,
    NewOpts.

merge_refreshed_opts(Opts, Refreshed) when is_map(Refreshed) ->
    Merged = hb_maps:merge(Refreshed, Opts, Opts),
    case hb_maps:find(<<"priv-wallet-hosted">>, Refreshed, Opts) of
        {ok, Wallets} -> Merged#{ <<"priv-wallet-hosted">> => Wallets };
        error -> Merged
    end;
merge_refreshed_opts(Opts, _Refreshed) ->
    Opts.

%% @doc Get the key provider from the base message or the defaults.
find_provider(Base, Opts) ->
    case hb_maps:get(<<"secret-provider">>, Base, no_key_provider, Opts) of
        no_key_provider ->
            case hb_opts:get(hook_secret_provider, no_key_provider, Opts) of
                no_key_provider -> {error, no_key_provider};
                SecretProvider -> SecretProvider
            end;
        SecretProvider when is_binary(SecretProvider) ->
            {ok, #{ <<"device">> => SecretProvider }};
        SecretProvider when is_map(SecretProvider) ->
            {ok, SecretProvider};
        _ ->
            {error, invalid_auth_provider}
    end.

%% @doc Find the appropriate handler for a key in the key provider.
call_provider(Key, Provider, Request, Opts) ->
    ?event({call_provider, {priv_key, Key}, {priv_provider, Provider}, {priv_req, Request}}),
    ExecKey = hb_maps:get(<< Key/binary, "-path">>, Provider, Key, Opts),
    ?event({call_provider, {exec_key, ExecKey}}),
    case hb_ao:resolve(Provider, Request#{ <<"path">> => ExecKey }, Opts) of
        {ok, Msg} when is_map(Msg) ->
            % The result is a message. We revert the path to its original value.
            case hb_maps:find(<<"path">>, Request, Opts) of
                {ok, Path} -> {ok, Msg#{ <<"path">> => Path }};
                _ -> {ok, Msg}
            end;
        {ok, _} = Res ->
            % The result is a non-message. We return it as-is.
            Res;
        {error, Err} ->
            ?event({call_provider_error, {priv_error, Err}}),
            {error, Err}
    end.

%% @doc Default keys to ignore when signing
ignored_keys(Msg, Opts) ->
    hb_maps:get(
        <<"ignored-keys">>,
        Msg,
        hb_opts:get(
            hook_auth_ignored_keys,
            ?DEFAULT_IGNORED_KEYS,
            Opts
        )
    ).

%%% Tests

cookie_test() ->
    % Start a node with a secret-provider that uses the cookie device.
    Node =
        hb_http_server:start_node(
            #{
                <<"priv-wallet">> => ServerWallet = ar_wallet:new(),
                <<"on">> => #{
                    <<"request">> => #{
                        <<"device">> => <<"auth-hook@1.0">>,
                        <<"path">> => <<"request">>,
                        <<"secret-provider">> =>
                            #{
                                <<"device">> => <<"cookie@1.0">>
                            }
                    }
                }
            }
        ),
    % Run a request and check that the response is signed. The cookie device
    % will generate a new cookie for the client.
    {ok, Response} =
        hb_http:get(
            Node,
            #{
                <<"path">> => <<"commitments">>,
                <<"body">> => <<"Test data">>
            },
            #{}
        ),
    % Filter the response to only include signed commitments.
    Signers = signers_from_commitments_response(Response, ServerWallet),
    ?event(
        {response, {found_signers, Signers}}
    ),    
    ?assertEqual(1, length(Signers)),
    % Generate a further request and check that the same address is used. Extract
    % the cookie given in the first request and use it to sign the second.
    [CookieAddress] = Signers,
    #{ <<"priv">> := CookiePriv } = Response,
    ?event(
        {cookie_from_response,
            {cookie_priv, CookiePriv},
            {cookie_address, CookieAddress}
        }
    ),
    {ok, Response2} =
        hb_http:get(
            Node,
            #{
                <<"path">> => <<"/commitments">>,
                <<"body">> => <<"Test data2">>,
                <<"priv">> => CookiePriv
            },
            #{}
        ),
    % Check that the second request is signed with the same address as the first.
    ?assertEqual(
        [CookieAddress],
        signers_from_commitments_response(Response2, ServerWallet)
    ).

http_auth_test() ->
    % Start a node with the `~http-auth@1.0' device as the secret-provider.
    Node =
        hb_http_server:start_node(
            #{
                <<"priv-wallet">> => ServerWallet = ar_wallet:new(),
                <<"on">> => #{
                    <<"request">> => #{
                        <<"device">> => <<"auth-hook@1.0">>,
                        <<"path">> => <<"request">>,
                        <<"secret-provider">> =>
                            #{
                                <<"device">> => <<"http-auth@1.0">>,
                                <<"access-control">> =>
                                    #{ <<"device">> => <<"http-auth@1.0">> }
                            }
                    }
                }
            }
        ),
    % Run a request and check that the response is a 401 with the
    % `www-authenticate' header.
    Resp1 =
        hb_http:get(
            Node,
            #{
                <<"path">> => <<"commitments">>,
                <<"body">> => <<"Test data">>
            },
            #{}
        ),
    ?assertMatch(
        {error, #{ <<"status">> := 401, <<"www-authenticate">> := _ }},
        Resp1
    ),
    % Run a request with the `Authorization' header and check that the response
    % is signed.
    AuthStr = << "Basic ", (base64:encode(<<"user:pass">>))/binary >>,
    Resp2 =
        hb_http:get(
            Node,
            #{
                <<"path">> => <<"commitments">>,
                <<"body">> => <<"Test data">>,
                <<"authorization">> => AuthStr
            },
            #{}
        ),
    ?assertMatch(
        {ok, #{ <<"status">> := 200 }},
        Resp2
    ),
    % Filter the response to only include signed commitments.
    Signers = signers_from_commitments_response(hb_util:ok(Resp2), ServerWallet),
    ?event(
        {response, {found_signers, Signers}}
    ),
    ?assertEqual(1, length(Signers)),
    % Generate a further request and check that the same address is used.
    [Signer] = Signers,
    {ok, Resp3} =
        hb_http:get(
            Node,
            #{
                <<"path">> => <<"commitments">>,
                <<"body">> => <<"Test data2">>,
                <<"authorization">> => AuthStr
            },
            #{}
        ),
    ?assertEqual(
        [Signer],
        signers_from_commitments_response(Resp3, ServerWallet)
    ).

odysee_auth_token_test() ->
    % Start a node with the `~odysee-auth@1.0' device as the secret-provider.
    % The hook is triggered by the posted `!' commit key; the Odysee auth token
    % is used only by the provider to derive the signing secret.
    Node =
        hb_http_server:start_node(
            #{
                <<"priv-wallet">> => ServerWallet = ar_wallet:new(),
                <<"on">> => #{
                    <<"request">> => #{
                        <<"device">> => <<"auth-hook@1.0">>,
                        <<"path">> => <<"request">>,
                        <<"when">> => #{
                            <<"keys">> => [<<"!">>]
                        },
                        <<"secret-provider">> =>
                            #{
                                <<"device">> => <<"odysee-auth@1.0">>,
                                <<"access-control">> =>
                                    #{ <<"device">> => <<"odysee-auth@1.0">> }
                            }
                    }
                }
            }
        ),
    Resp1 =
        hb_http:get(
            Node,
            #{
                <<"path">> => <<"commitments">>,
                <<"body">> => <<"Test data">>,
                <<"!">> => true
            },
            #{}
        ),
    ?assertMatch(
        {error, #{ <<"status">> := 401, <<"www-authenticate">> := _ }},
        Resp1
    ),
    Cookie = <<"auth_token=odysee-test-token">>,
    Resp2 =
        hb_http:get(
            Node,
            #{
                <<"path">> => <<"commitments">>,
                <<"body">> => <<"Test data">>,
                <<"cookie">> => Cookie,
                <<"!">> => true,
                <<"iterations">> => 1,
                <<"key-length">> => 32
            },
            #{}
        ),
    ?assertMatch(
        {ok, #{ <<"status">> := 200 }},
        Resp2
    ),
    Signers = signers_from_commitments_response(hb_util:ok(Resp2), ServerWallet),
    ?assertEqual(1, length(Signers)),
    [Signer] = Signers,
    Resp3 =
        hb_http:get(
            Node,
            #{
                <<"path">> => <<"commitments">>,
                <<"body">> => <<"Test data2">>,
                <<"cookie">> => Cookie,
                <<"!">> => true,
                <<"iterations">> => 1,
                <<"key-length">> => 32
            },
            #{}
        ),
    ?assertEqual(
        [Signer],
        signers_from_commitments_response(hb_util:ok(Resp3), ServerWallet)
    ).

chained_preprocess_test() ->
    % Start a node with the `~http-auth@1.0' device as the secret-provider, with
    % a router chained afterwards in the request hook.
    RelayWallet = ar_wallet:new(),
    RelayAddress = hb_util:human_id(RelayWallet),
    RelayURL = hb_http_server:start_node(#{ <<"priv-wallet">> => RelayWallet }),
    Node =
        hb_http_server:start_node(
            #{
                <<"priv-wallet">> => ar_wallet:new(),
                <<"relay-allow-commit-request">> => true,
                <<"on">> => #{
                    <<"request">> =>
                        [
                            #{
                                <<"device">> => <<"auth-hook@1.0">>,
                                <<"path">> => <<"request">>,
                                <<"secret-provider">> =>
                                    #{
                                        <<"device">> => <<"http-auth@1.0">>,
                                        <<"access-control">> =>
                                            #{
                                                <<"device">> => <<"http-auth@1.0">>
                                            }
                                    }
                            },
                            #{
                                <<"device">> => <<"router@1.0">>,
                                <<"path">> => <<"preprocess">>,
                                <<"commit-request">> => true
                            }
                        ]
                },
                <<"routes">> => [
                    #{
                        <<"template">> => <<"/~meta@1.0/info/address">>,
                        <<"node">> => #{ <<"prefix">> => RelayURL }
                    }
                ]
            }
        ),
    % Run a request with the `Authorization' header and check that the response
    % is signed.
    AuthStr = << "Basic ", (base64:encode(<<"user:pass">>))/binary >>,
    Resp1 =
        hb_http:get(
            Node,
            #{
                <<"path">> => <<"/~meta@1.0/info/address">>,
                <<"authorization">> => AuthStr
            },
            #{}
        ),
    ?assertMatch({ok, RelayAddress}, Resp1).

when_test() ->
    % Start a node with the `~http-auth@1.0' device as the secret-provider. Only
    % request commitment with the hook if the `Authorization' header is present.
    Node =
        hb_http_server:start_node(
            #{
                <<"priv-wallet">> => ServerWallet = ar_wallet:new(),
                <<"on">> => #{
                    <<"request">> => #{
                        <<"device">> => <<"auth-hook@1.0">>,
                        <<"path">> => <<"request">>,
                        <<"when">> => #{
                            <<"keys">> => [<<"authorization">>]
                        },
                        <<"secret-provider">> =>
                            #{
                                <<"device">> => <<"http-auth@1.0">>,
                                <<"access-control">> =>
                                    #{ <<"device">> => <<"http-auth@1.0">> }
                            }
                    }
                }
            }
        ),
    % Run a request and check that the response is not signed, but is `status: 200'.
    {ok, Resp1} =
        hb_http:get(
            Node,
            #{
                <<"path">> => <<"~meta@1.0/info">>,
                <<"body">> => <<"Test data">>
            },
            #{}
        ),
    ?assertEqual(200, hb_maps:get(<<"status">>, Resp1, 0)),
    % Run a request with the `Authorization' header and check that the response
    % is signed.
    AuthStr = << "Basic ", (base64:encode(<<"user:pass">>))/binary >>,
    Resp2 =
        hb_http:get(
            Node,
            #{
                <<"path">> => <<"commitments">>,
                <<"body">> => <<"Test data">>,
                <<"authorization">> => AuthStr
            },
            #{}
        ),
    ?assertMatch(
        {ok, #{ <<"status">> := 200 }},
        Resp2
    ),
    ?assertMatch(
        [_],
        signers_from_commitments_response(
            hb_util:ok(Resp2),
            ServerWallet
        )
    ).

%% @doc Generic-path write law: `POST /id?!=true' through the cookie-secured
%% auth hook (with `store-all-signed' enabled) must persist the signed message
%% to the node's store, and a bare `GET /<id>' must serve it back.
cookie_hook_upload_store_get_by_id_test() ->
    Timestamp = integer_to_binary(erlang:unique_integer([positive, monotonic])),
    Store =
        #{
            <<"store-module">> => hb_store_fs,
            <<"name">> => <<"_build/auth-hook-TEST/upload-", Timestamp/binary>>
        },
    hb_store:reset(Store),
    Opts = #{ <<"store">> => [Store] },
    Node =
        hb_http_server:start_node(
            Opts#{
                <<"store-all-signed">> => true,
                <<"on">> => #{
                    <<"request">> => #{
                        <<"device">> => <<"auth-hook@1.0">>,
                        <<"path">> => <<"request">>,
                        <<"when">> => #{ <<"keys">> => [<<"!">>] },
                        <<"secret-provider">> => #{ <<"device">> => <<"cookie@1.0">> }
                    }
                }
            }
        ),
    Body = <<"hello-sam">>,
    {ok, UploadRes} =
        hb_http:post(
            Node,
            #{
                <<"path">> => <<"/id?!=true">>,
                <<"body">> => Body,
                <<"accept">> => <<"application/json">>,
                <<"accept-bundle">> => false
            },
            #{}
    ),
    ID = stored_id(UploadRes, Opts),
    {ok, Stored} = hb_cache:read(ID, Opts),
    ?assertEqual(Body, hb_maps:get(<<"body">>, hb_cache:ensure_all_loaded(Stored, Opts), not_found, Opts)),
    ?assertMatch(
        {ok, #{ <<"body">> := Body }},
        hb_http:get(Node, <<"/", ID/binary>>, #{ <<"accept">> => <<"application/json">> })
    ).

stored_id(Res, Opts) when is_binary(Res) ->
    case hb_cache:read(Res, Opts) of
        {ok, _} ->
            Res;
        _ ->
            stored_id(hb_json:decode(Res), Opts)
    end;
stored_id(Res, Opts) when is_map(Res) ->
    readable_id(id_candidates(Res, Opts), Opts).

id_candidates(Res, Opts) ->
    Direct =
        [
            hb_maps:get(<<"id">>, Res, not_found, Opts),
            hb_maps:get(<<"path">>, Res, not_found, Opts),
            hb_maps:get(<<"read-path">>, Res, not_found, Opts),
            hb_maps:get(<<"read_path">>, Res, not_found, Opts),
            hb_maps:get(<<"body">>, Res, not_found, Opts)
        ],
    Commitments = hb_maps:get(<<"commitments">>, Res, #{}, Opts),
    [
        Candidate
    ||
        Candidate <- lists:map(
            fun normalize_id_candidate/1,
            Direct ++ commitment_ids(Commitments, Opts)
        ),
        is_binary(Candidate)
    ].

commitment_ids(Commitments, Opts) when is_map(Commitments) ->
    hb_maps:keys(Commitments, Opts);
commitment_ids(_Commitments, _Opts) ->
    [].

normalize_id_candidate(<<"/", ID/binary>>) ->
    ID;
normalize_id_candidate(Candidate) ->
    Candidate.

readable_id([ID | Rest], Opts) ->
    case hb_cache:read(ID, Opts) of
        {ok, _} ->
            ID;
        _ ->
            readable_id(Rest, Opts)
    end;
readable_id([], _Opts) ->
    erlang:error(upload_id_not_found).

%% @doc Ensure that signed requests are stored and recallable if
%% `store-all-signed' is enabled.
store_hook_signed_test() ->
    Node =
        hb_http_server:start_node(
            #{
                <<"port">> => 0,
                <<"store-all-signed">> => true,
                <<"on">> => #{
                    <<"request">> => #{
                        <<"device">> => <<"auth-hook@1.0">>,
                        <<"path">> => <<"request">>,
                        <<"when">> => #{ <<"keys">> => [<<"!">>] },
                        <<"secret-provider">> => #{
                            <<"device">> => <<"http-auth@1.0">>,
                            <<"access-control">> => #{
                                <<"device">> => <<"http-auth@1.0">>
                            }
                        }
                    }
                }
            }
        ),
    AuthStr = <<"Basic ", (base64:encode(<<"user:pass">>))/binary>>,
    {ok, ID} =
        hb_http:post(
            Node,
            #{
                <<"path">> => <<"/id?committers=all&!">>,
                <<"authorization">> => AuthStr,
                <<"stored-key">> => <<"stored-value">>
            },
            #{}
        ),
    {ok, Read} = hb_http:get(Node, <<"/", ID/binary>>, #{}),
    ?assertEqual(<<"stored-value">>, hb_ao:get(<<"stored-key">>, Read, #{})).

%% @doc The cookie hook test(s) call `GET /commitments', which returns the
%% commitments found on the client request during execution on the server.
%% This function filters the response to return only the signers of that message,
%% excluding the server's own signature.
signers_from_commitments_response(Response, ServerWallet) ->
    ServerAddress = ar_wallet:to_address(ServerWallet),
    hb_maps:values(hb_maps:filtermap(
        fun(Key, Value) when ?IS_ID(Key) ->
            Type = hb_maps:get(<<"type">>, Value, not_found, #{}),
            Committer = hb_maps:get(<<"committer">>, Value, not_found, #{}),
            case {Type, Committer} of
                {<<"rsa-pss-sha512">>, ServerAddress} -> false;
                {<<"rsa-pss-sha512">>, _} -> {true, Committer};
                _ -> false
            end;
           (_Key, _Value) ->
            false
        end,
        Response,
        #{}
    )).
