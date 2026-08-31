%%% @doc Authenticated encryption boundary for private Odysee records.
%%%
%%% The device stores no state. It seals private playlist plaintext with key
%%% material derived from the authenticated hosted wallet and opens it only for
%%% that same wallet. The purpose is included in both key derivation and AEAD
%%% additional data so ciphertext cannot be substituted across private-data
%%% domains.
-module(dev_odysee_private).
-implements(<<"odysee-private@1.0">>).
-export([info/1, owner/3, seal/3, open/3]).
-include_lib("eunit/include/eunit.hrl").

-define(ALGORITHM, <<"aes-256-gcm">>).
-define(KEY_VERSION, 1).
-define(MAX_PLAINTEXT_BYTES, 262144).
-define(PURPOSE, <<"playlist">>).
-define(KEY_DOMAIN, <<"odysee-private-playlist-encryption-v1">>).
-define(AAD_DOMAIN, <<"odysee-private-playlist@1.0">>).

info(_Opts) ->
    #{ exports => [<<"owner">>, <<"seal">>, <<"open">>] }.

owner(Base, Req, Opts) ->
    case authenticated_wallet(Base, Req, Opts) of
        {ok, #{ <<"address">> := Address }} ->
            {ok, private_response(#{ <<"owner">> => Address, <<"body">> => Address })};
        {error, _} = Error ->
            Error
    end.

seal(Base, Req, Opts) ->
    case {
        authenticated_wallet(Base, Req, Opts),
        hb_maps:get(<<"purpose">>, Req, undefined, Opts),
        hb_maps:get(<<"plaintext">>, Req, undefined, Opts)
    } of
        {{ok, Wallet}, ?PURPOSE, Plaintext}
                when is_binary(Plaintext),
                     byte_size(Plaintext) > 0,
                     byte_size(Plaintext) =< ?MAX_PLAINTEXT_BYTES ->
            {ok, private_response(encrypt(Plaintext, Wallet, domains()))};
        {{ok, _Wallet}, ?PURPOSE, Plaintext}
                when is_binary(Plaintext), byte_size(Plaintext) > ?MAX_PLAINTEXT_BYTES ->
            error_response(413, <<"Private playlist plaintext exceeds the 256 KiB limit.">>);
        {{ok, _Wallet}, ?PURPOSE, _Invalid} ->
            error_response(400, <<"Private playlist plaintext must be a non-empty binary value.">>);
        {{ok, _Wallet}, _Purpose, _Plaintext} ->
            error_response(400, <<"Unsupported private-data purpose.">>);
        {{error, _} = Error, _Purpose, _Plaintext} ->
            Error
    end.

open(Base, Req, Opts) ->
    case {
        authenticated_wallet(Base, Req, Opts),
        hb_maps:get(<<"purpose">>, Req, undefined, Opts)
    } of
        {{ok, Wallet = #{ <<"address">> := Address }}, ?PURPOSE} ->
            case hb_maps:get(<<"owner">>, Req, undefined, Opts) of
                Address ->
                    case decrypt(Req, Wallet, Opts, domains()) of
                        {ok, Plaintext} ->
                            {ok,
                                private_response(
                                    #{ <<"plaintext">> => Plaintext, <<"body">> => Plaintext }
                                )};
                        {error, _} ->
                            error_response(400, <<"Private playlist ciphertext failed authentication.">>)
                    end;
                _ ->
                    error_response(403, <<"Private playlist ciphertext belongs to another owner.">>)
            end;
        {{ok, _Wallet}, _Purpose} ->
            error_response(400, <<"Unsupported private-data purpose.">>);
        {{error, _} = Error, _Purpose} ->
            Error
    end.

authenticated_wallet(Base, Req, Opts) ->
    SecretBase = Base#{ <<"device">> => <<"secret@1.0">> },
    SecretReq = Req#{ <<"path">> => <<"export">> },
    case hb_ao:resolve(SecretBase, SecretReq, Opts) of
        {ok, [Wallet = #{ <<"wallet">> := Key, <<"address">> := Address }]}
                when is_binary(Key), is_binary(Address) ->
            {ok, Wallet};
        {ok, []} ->
            error_response(401, <<"No authenticated private-data wallet was found.">>);
        {ok, _Wallets} ->
            error_response(409, <<"Exactly one authenticated private-data wallet is required.">>);
        {error, Reason} when is_map(Reason) ->
            {error, Reason};
        {error, _Reason} ->
            error_response(401, <<"Private-data wallet authentication failed.">>)
    end.

domains() ->
    #{ key => ?KEY_DOMAIN, aad => ?AAD_DOMAIN, purpose => ?PURPOSE }.

encrypt(Plaintext, Wallet = #{ <<"address">> := Address }, Domains) ->
    IV = crypto:strong_rand_bytes(12),
    {Ciphertext, Tag} =
        crypto:crypto_one_time_aead(
            aes_256_gcm,
            encryption_key(Wallet, Domains),
            IV,
            Plaintext,
            additional_data(Address, Domains),
            16,
            true
        ),
    #{
        <<"algorithm">> => ?ALGORITHM,
        <<"key-version">> => ?KEY_VERSION,
        <<"purpose">> => maps:get(purpose, Domains),
        <<"owner">> => Address,
        <<"iv">> => hb_util:encode(IV),
        <<"ciphertext">> => hb_util:encode(Ciphertext),
        <<"tag">> => hb_util:encode(Tag)
    }.

decrypt(Req, Wallet = #{ <<"address">> := Address }, Opts, Domains) ->
    try
        ?ALGORITHM = hb_maps:get(<<"algorithm">>, Req, undefined, Opts),
        ?KEY_VERSION = hb_util:int(hb_maps:get(<<"key-version">>, Req, undefined, Opts)),
        Purpose = maps:get(purpose, Domains),
        Purpose = hb_maps:get(<<"purpose">>, Req, undefined, Opts),
        IV = hb_util:decode(hb_maps:get(<<"iv">>, Req, undefined, Opts)),
        Ciphertext = hb_util:decode(hb_maps:get(<<"ciphertext">>, Req, undefined, Opts)),
        Tag = hb_util:decode(hb_maps:get(<<"tag">>, Req, undefined, Opts)),
        true = byte_size(IV) =:= 12,
        true = byte_size(Tag) =:= 16,
        true = byte_size(Ciphertext) > 0,
        true = byte_size(Ciphertext) =< ?MAX_PLAINTEXT_BYTES,
        case crypto:crypto_one_time_aead(
            aes_256_gcm,
            encryption_key(Wallet, Domains),
            IV,
            Ciphertext,
            additional_data(Address, Domains),
            Tag,
            false
        ) of
            Plaintext when is_binary(Plaintext) -> {ok, Plaintext};
            _ -> {error, invalid_ciphertext}
        end
    catch
        _:_ -> {error, invalid_ciphertext}
    end.

encryption_key(#{ <<"wallet">> := Key, <<"address">> := Address }, Domains) ->
    KeyDomain = maps:get(key, Domains),
    Purpose = maps:get(purpose, Domains),
    crypto:hash(sha256, <<KeyDomain/binary, 0, Purpose/binary, 0, Address/binary, 0, Key/binary>>).

additional_data(Address, Domains) ->
    AadDomain = maps:get(aad, Domains),
    Purpose = maps:get(purpose, Domains),
    <<AadDomain/binary, 0, Purpose/binary, 0, Address/binary>>.

private_response(Response) ->
    Response#{
        <<"cache-control">> => <<"no-store, private">>,
        <<"pragma">> => <<"no-cache">>
    }.

error_response(Status, Details) ->
    {error, #{ <<"status">> => Status, <<"details">> => Details }}.

crypto_roundtrip_test() ->
    Wallet = test_wallet(),
    Plaintext = <<"{\"title\":\"private playlist\"}">>,
    Envelope = encrypt(Plaintext, Wallet, domains()),
    ?assertEqual({ok, Plaintext}, decrypt(Envelope, Wallet, #{}, domains())),
    ?assertEqual(false, lists:member(Plaintext, maps:values(Envelope))).

wrong_wallet_cannot_open_test() ->
    Envelope = encrypt(<<"private">>, test_wallet(), domains()),
    ?assertEqual({error, invalid_ciphertext}, decrypt(Envelope, test_wallet(), #{}, domains())).

tampered_ciphertext_cannot_open_test() ->
    Wallet = test_wallet(),
    Envelope = encrypt(<<"private">>, Wallet, domains()),
    Ciphertext = hb_util:decode(maps:get(<<"ciphertext">>, Envelope)),
    <<First, Rest/binary>> = Ciphertext,
    Tampered = Envelope#{ <<"ciphertext">> := hb_util:encode(<<(First bxor 1), Rest/binary>>) },
    ?assertEqual({error, invalid_ciphertext}, decrypt(Tampered, Wallet, #{}, domains())).

cross_domain_ciphertext_cannot_open_test() ->
    Wallet = test_wallet(),
    Envelope = encrypt(<<"private">>, Wallet, domains()),
    OtherDomains = #{
        key => <<"odysee-preference-encryption-v1">>,
        aad => <<"odysee-preferences@1.0">>,
        purpose => ?PURPOSE
    },
    ?assertEqual({error, invalid_ciphertext}, decrypt(Envelope, Wallet, #{}, OtherDomains)).

oversized_ciphertext_cannot_open_test() ->
    Wallet = test_wallet(),
    Envelope = (encrypt(<<"private">>, Wallet, domains()))#{
        <<"ciphertext">> => hb_util:encode(binary:copy(<<0>>, ?MAX_PLAINTEXT_BYTES + 1))
    },
    ?assertEqual({error, invalid_ciphertext}, decrypt(Envelope, Wallet, #{}, domains())).

test_wallet() ->
    Wallet = ar_wallet:new(),
    {Private, _Public} = Wallet,
    #{
        <<"wallet">> => ar_wallet:to_json(Private),
        <<"address">> => hb_util:human_id(ar_wallet:to_address(Wallet))
    }.
