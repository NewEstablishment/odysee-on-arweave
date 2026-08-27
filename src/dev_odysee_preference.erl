%%% @doc Authenticated encryption boundary for private Odysee preferences.
%%%
%%% Preference snapshots are ordinary signed messages and their mutable head is
%%% a generic `reference@1.0' record. This device does not store either object.
%%% It only seals plaintext with key material derived from the authenticated
%%% hosted wallet and opens ciphertext for that same wallet. The request body
%%% is excluded from the auth verification commitment by the pinned
%%% `secret@1.0' compatibility patch, and every response is marked no-store.
-module(dev_odysee_preference).
-implements(<<"odysee-preference@1.0">>).
-export([info/1, owner/3, seal/3, open/3]).
-include_lib("eunit/include/eunit.hrl").

-define(ALGORITHM, <<"aes-256-gcm">>).
-define(KEY_VERSION, 1).
-define(MAX_PLAINTEXT_BYTES, 262144).
-define(KEY_DOMAIN, <<"odysee-preference-encryption-v1">>).
-define(AAD_DOMAIN, <<"odysee-preferences@1.0">>).

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
        hb_maps:get(<<"plaintext">>, Req, undefined, Opts)
    } of
        {{ok, Wallet}, Plaintext}
                when is_binary(Plaintext),
                     byte_size(Plaintext) =< ?MAX_PLAINTEXT_BYTES ->
            {ok, private_response(encrypt(Plaintext, Wallet))};
        {{ok, _Wallet}, Plaintext} when is_binary(Plaintext) ->
            error_response(413, <<"Preference plaintext exceeds the 256 KiB limit.">>);
        {{ok, _Wallet}, _Invalid} ->
            error_response(400, <<"Preference plaintext must be a binary value.">>);
        {{error, _} = Error, _} ->
            Error
    end.

open(Base, Req, Opts) ->
    case authenticated_wallet(Base, Req, Opts) of
        {ok, Wallet = #{ <<"address">> := Address }} ->
            case hb_maps:get(<<"owner">>, Req, undefined, Opts) of
                Address ->
                    case decrypt(Req, Wallet, Opts) of
                        {ok, Plaintext} ->
                            {ok,
                                private_response(
                                    #{ <<"plaintext">> => Plaintext, <<"body">> => Plaintext }
                                )};
                        {error, _} ->
                            error_response(400, <<"Preference ciphertext failed authentication.">>)
                    end;
                _ ->
                    error_response(403, <<"Preference ciphertext belongs to another owner.">>)
            end;
        {error, _} = Error ->
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
            error_response(401, <<"No authenticated preference wallet was found.">>);
        {ok, _Wallets} ->
            error_response(409, <<"Exactly one authenticated preference wallet is required.">>);
        {error, Reason} when is_map(Reason) ->
            {error, Reason};
        {error, _Reason} ->
            error_response(401, <<"Preference wallet authentication failed.">>)
    end.

encrypt(Plaintext, Wallet = #{ <<"address">> := Address }) ->
    IV = crypto:strong_rand_bytes(12),
    {Ciphertext, Tag} =
        crypto:crypto_one_time_aead(
            aes_256_gcm,
            encryption_key(Wallet),
            IV,
            Plaintext,
            additional_data(Address),
            16,
            true
        ),
    #{
        <<"algorithm">> => ?ALGORITHM,
        <<"key-version">> => ?KEY_VERSION,
        <<"owner">> => Address,
        <<"iv">> => hb_util:encode(IV),
        <<"ciphertext">> => hb_util:encode(Ciphertext),
        <<"tag">> => hb_util:encode(Tag)
    }.

decrypt(Req, Wallet = #{ <<"address">> := Address }, Opts) ->
    try
        ?ALGORITHM = hb_maps:get(<<"algorithm">>, Req, undefined, Opts),
        ?KEY_VERSION = hb_util:int(hb_maps:get(<<"key-version">>, Req, undefined, Opts)),
        IV = hb_util:decode(hb_maps:get(<<"iv">>, Req, undefined, Opts)),
        Ciphertext = hb_util:decode(hb_maps:get(<<"ciphertext">>, Req, undefined, Opts)),
        Tag = hb_util:decode(hb_maps:get(<<"tag">>, Req, undefined, Opts)),
        true = byte_size(IV) =:= 12,
        true = byte_size(Tag) =:= 16,
        true = byte_size(Ciphertext) > 0,
        true = byte_size(Ciphertext) =< ?MAX_PLAINTEXT_BYTES,
        case crypto:crypto_one_time_aead(
            aes_256_gcm,
            encryption_key(Wallet),
            IV,
            Ciphertext,
            additional_data(Address),
            Tag,
            false
        ) of
            Plaintext when is_binary(Plaintext) -> {ok, Plaintext};
            _ -> {error, invalid_ciphertext}
        end
    catch
        _:_ -> {error, invalid_ciphertext}
    end.

encryption_key(#{ <<"wallet">> := Key, <<"address">> := Address }) ->
    crypto:hash(sha256, <<?KEY_DOMAIN/binary, 0, Address/binary, 0, Key/binary>>).

additional_data(Address) ->
    <<?AAD_DOMAIN/binary, 0, Address/binary>>.

private_response(Response) ->
    Response#{
        <<"cache-control">> => <<"no-store, private">>,
        <<"pragma">> => <<"no-cache">>
    }.

error_response(Status, Details) ->
    {error, #{ <<"status">> => Status, <<"details">> => Details }}.

crypto_roundtrip_test() ->
    Wallet = test_wallet(),
    Plaintext = <<"{\"shared\":{\"theme\":\"dark\"}}">>,
    Envelope = encrypt(Plaintext, Wallet),
    ?assertEqual({ok, Plaintext}, decrypt(Envelope, Wallet, #{})),
    ?assertEqual(false, lists:member(Plaintext, maps:values(Envelope))).

wrong_wallet_cannot_open_test() ->
    Envelope = encrypt(<<"private">>, test_wallet()),
    ?assertEqual({error, invalid_ciphertext}, decrypt(Envelope, test_wallet(), #{})).

tampered_ciphertext_cannot_open_test() ->
    Wallet = test_wallet(),
    Envelope = encrypt(<<"private">>, Wallet),
    Ciphertext = hb_util:decode(maps:get(<<"ciphertext">>, Envelope)),
    <<First, Rest/binary>> = Ciphertext,
    Tampered = Envelope#{ <<"ciphertext">> := hb_util:encode(<<(First bxor 1), Rest/binary>>) },
    ?assertEqual({error, invalid_ciphertext}, decrypt(Tampered, Wallet, #{})).

oversized_ciphertext_cannot_open_test() ->
    Wallet = test_wallet(),
    Envelope = (encrypt(<<"private">>, Wallet))#{
        <<"ciphertext">> => hb_util:encode(binary:copy(<<0>>, ?MAX_PLAINTEXT_BYTES + 1))
    },
    ?assertEqual({error, invalid_ciphertext}, decrypt(Envelope, Wallet, #{})).

test_wallet() ->
    Wallet = ar_wallet:new(),
    {Private, _Public} = Wallet,
    #{
        <<"wallet">> => ar_wallet:to_json(Private),
        <<"address">> => hb_util:human_id(ar_wallet:to_address(Wallet))
    }.
