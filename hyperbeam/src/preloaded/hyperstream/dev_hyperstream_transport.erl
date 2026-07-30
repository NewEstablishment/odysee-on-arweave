%%% @doc Ephemeral encrypted transport for `hyperstream@1.0'.
%%%
%%% The helper owns one memory-only P-256 key pair for the lifetime of the
%%% Erlang node. Requests and responses are flat, bounded, canonical base64url
%%% envelopes so normal HyperBEAM signing, hooks, and storage see ciphertext
%%% rather than signaling payloads or capabilities.
-module(dev_hyperstream_transport).
-export([key_info/0, open/2, seal/3]).
-ifdef(TEST).
-include_lib("eunit/include/eunit.hrl").
-endif.

-define(DEVICE, <<"hyperstream@1.0">>).
-define(TRANSPORT, <<"hs1">>).
-define(ALGORITHM, <<"ECDH-P256-HKDF-SHA256-AES-256-GCM">>).
-define(KEY_BYTES, 32).
-define(PUBLIC_KEY_BYTES, 65).
-define(NONCE_BYTES, 12).
-define(TAG_BYTES, 16).
-define(MAX_OPERATION_BYTES, 64).
-define(MAX_PLAINTEXT_BYTES, 33554432).
-define(KEY_PAIR, {?MODULE, key_pair}).

%% @doc Return the node's flat public transport-key descriptor.
key_info() ->
    #{public := Public, key_id := KeyID} = key_pair(),
    #{
        <<"device">> => ?DEVICE,
        <<"transport">> => ?TRANSPORT,
        <<"algorithm">> => ?ALGORITHM,
        <<"key-id">> => KeyID,
        <<"public-key">> => hb_util:encode(Public)
    }.

%% @doc Authenticate and decrypt one request envelope.
open(Operation0, Envelope) when is_binary(Envelope) ->
    case normalize_operation(Operation0) of
        {ok, Operation} ->
            open_envelope(Operation, Envelope);
        error ->
            {error, invalid_operation}
    end;
open(_Operation, _Envelope) ->
    {error, invalid_envelope}.

%% @doc Encrypt one response using the request's transport context.
seal(Operation0, Plaintext, Context) when is_binary(Plaintext), is_map(Context) ->
    case {
        normalize_operation(Operation0),
        byte_size(Plaintext) =< ?MAX_PLAINTEXT_BYTES
    } of
        {{ok, Operation}, true} ->
            seal_response(Operation, Plaintext, Context);
        {{ok, _Operation}, false} ->
            {error, plaintext_too_large};
        {error, _} ->
            {error, invalid_operation}
    end;
seal(_Operation, _Plaintext, _Context) ->
    {error, invalid_plaintext}.

open_envelope(Operation, Envelope) ->
    case byte_size(Envelope) =< max_request_envelope_bytes() of
        false ->
            {error, envelope_too_large};
        true ->
            case binary:split(Envelope, <<".">>, [global]) of
                [
                    ?TRANSPORT,
                    EncodedKeyID,
                    EncodedClientPublic,
                    EncodedNonce,
                    EncodedCiphertext
                ] ->
                    open_fields(
                        Operation,
                        EncodedKeyID,
                        EncodedClientPublic,
                        EncodedNonce,
                        EncodedCiphertext
                    );
                _ ->
                    {error, invalid_envelope}
            end
    end.

open_fields(
    Operation,
    EncodedKeyID,
    EncodedClientPublic,
    EncodedNonce,
    EncodedCiphertext
) ->
    maybe
        {ok, KeyID} ?= decode_exact(
            EncodedKeyID,
            ?KEY_BYTES,
            invalid_key_id
        ),
        #{public := NodePublic, private := NodePrivate, key_id := CurrentKeyID} =
            key_pair(),
        true ?=
            KeyID =:= hb_util:decode(CurrentKeyID)
                orelse {error, unknown_key},
        {ok, ClientPublic} ?= decode_public_key(EncodedClientPublic),
        {ok, Nonce} ?= decode_exact(
            EncodedNonce,
            ?NONCE_BYTES,
            invalid_nonce
        ),
        {ok, Ciphertext, Tag} ?= decode_ciphertext(EncodedCiphertext),
        {ok, Shared} ?= shared_secret(ClientPublic, NodePrivate),
        Key = derive_key(Shared, NodePublic, ClientPublic, CurrentKeyID),
        AAD = aad(<<"request">>, Operation, CurrentKeyID),
        {ok, Plaintext} ?= decrypt(Key, Nonce, Ciphertext, AAD, Tag),
        {
            ok,
            Plaintext,
            #{
                transport => ?TRANSPORT,
                operation => Operation,
                key_id => CurrentKeyID,
                key => Key
            }
        }
    else
        {error, _Reason} = Error -> Error;
        false -> {error, invalid_envelope};
        _ -> {error, invalid_envelope}
    end.

seal_response(
    Operation,
    Plaintext,
    #{
        transport := ?TRANSPORT,
        operation := Operation,
        key_id := KeyID,
        key := Key
    }
) when
        is_binary(KeyID),
        byte_size(KeyID) =:= 43,
        is_binary(Key),
        byte_size(Key) =:= ?KEY_BYTES ->
    Nonce = crypto:strong_rand_bytes(?NONCE_BYTES),
    AAD = aad(<<"response">>, Operation, KeyID),
    try
        {Ciphertext, Tag} = crypto:crypto_one_time_aead(
            aes_256_gcm,
            Key,
            Nonce,
            Plaintext,
            AAD,
            true
        ),
        EncodedNonce = hb_util:encode(Nonce),
        EncodedCiphertext = hb_util:encode(<<Ciphertext/binary, Tag/binary>>),
        {
            ok,
            <<
                "hs1r.",
                KeyID/binary,
                ".",
                EncodedNonce/binary,
                ".",
                EncodedCiphertext/binary
            >>
        }
    catch
        _:_ -> {error, encryption_failed}
    end;
seal_response(_Operation, _Plaintext, _Context) ->
    {error, invalid_context}.

key_pair() ->
    case persistent_term:get(?KEY_PAIR, undefined) of
        undefined ->
            global:trans(
                {?KEY_PAIR, self()},
                fun() ->
                    case persistent_term:get(?KEY_PAIR, undefined) of
                        undefined ->
                            {Public, Private} =
                                crypto:generate_key(ecdh, secp256r1),
                            Pair = #{
                                public => Public,
                                private => Private,
                                key_id =>
                                    hb_util:encode(
                                        crypto:hash(sha256, Public)
                                    )
                            },
                            persistent_term:put(?KEY_PAIR, Pair),
                            Pair;
                        Pair ->
                            Pair
                    end
                end
            );
        Pair ->
            Pair
    end.

normalize_operation(Operation) when is_atom(Operation) ->
    normalize_operation(atom_to_binary(Operation));
normalize_operation(Operation) when
        is_binary(Operation),
        byte_size(Operation) > 0,
        byte_size(Operation) =< ?MAX_OPERATION_BYTES ->
    case valid_operation_bytes(Operation) of
        true -> {ok, Operation};
        false -> error
    end;
normalize_operation(_Operation) ->
    error.

valid_operation_bytes(<<>>) ->
    true;
valid_operation_bytes(<<Byte, Rest/binary>>) when
        Byte >= $a, Byte =< $z;
        Byte >= $0, Byte =< $9;
        Byte =:= $- ->
    valid_operation_bytes(Rest);
valid_operation_bytes(_Operation) ->
    false.

decode_public_key(Encoded) ->
    case decode_exact(Encoded, ?PUBLIC_KEY_BYTES, invalid_client_key) of
        {ok, <<4, _/binary>> = Public} -> {ok, Public};
        _ -> {error, invalid_client_key}
    end.

decode_exact(Encoded, ExpectedBytes, Reason) when is_binary(Encoded) ->
    case byte_size(Encoded) =:= encoded_length(ExpectedBytes) of
        true ->
            case decode_canonical(Encoded) of
                {ok, Decoded} when byte_size(Decoded) =:= ExpectedBytes ->
                    {ok, Decoded};
                _ ->
                    {error, Reason}
            end;
        false ->
            {error, Reason}
    end;
decode_exact(_Encoded, _ExpectedBytes, Reason) ->
    {error, Reason}.

decode_ciphertext(Encoded) when is_binary(Encoded) ->
    ValidSize =
        byte_size(Encoded) >= encoded_length(?TAG_BYTES)
        andalso
            byte_size(Encoded) =<
                encoded_length(?MAX_PLAINTEXT_BYTES + ?TAG_BYTES),
    case ValidSize of
        true ->
            case decode_canonical(Encoded) of
                {ok, Combined} when
                        byte_size(Combined) >= ?TAG_BYTES,
                        byte_size(Combined) =<
                            ?MAX_PLAINTEXT_BYTES + ?TAG_BYTES ->
                    CiphertextBytes = byte_size(Combined) - ?TAG_BYTES,
                    <<
                        Ciphertext:CiphertextBytes/binary,
                        Tag:?TAG_BYTES/binary
                    >> = Combined,
                    {ok, Ciphertext, Tag};
                _ ->
                    {error, invalid_ciphertext}
            end;
        false ->
            {error, invalid_ciphertext}
    end;
decode_ciphertext(_Encoded) ->
    {error, invalid_ciphertext}.

decode_canonical(Encoded) ->
    case valid_base64url(Encoded) of
        false ->
            {error, invalid_base64url};
        true ->
            case hb_util:safe_decode(Encoded) of
                {ok, Decoded} ->
                    case hb_util:encode(Decoded) of
                        Encoded -> {ok, Decoded};
                        _ -> {error, invalid_base64url}
                    end;
                _ ->
                    {error, invalid_base64url}
            end
    end.

valid_base64url(<<>>) ->
    true;
valid_base64url(<<Byte, Rest/binary>>) when
        Byte >= $A, Byte =< $Z;
        Byte >= $a, Byte =< $z;
        Byte >= $0, Byte =< $9;
        Byte =:= $_;
        Byte =:= $- ->
    valid_base64url(Rest);
valid_base64url(_Encoded) ->
    false.

shared_secret(ClientPublic, NodePrivate) ->
    try
        {ok,
            crypto:compute_key(
                ecdh,
                ClientPublic,
                NodePrivate,
                secp256r1
            )
        }
    catch
        _:_ -> {error, invalid_client_key}
    end.

derive_key(Shared, NodePublic, ClientPublic, KeyID) ->
    Salt = crypto:hash(
        sha256,
        <<NodePublic/binary, ClientPublic/binary>>
    ),
    PseudoRandomKey = crypto:mac(hmac, sha256, Salt, Shared),
    Info = <<"hyperstream@1.0/transport/", KeyID/binary>>,
    crypto:mac(hmac, sha256, PseudoRandomKey, <<Info/binary, 1>>).

aad(Direction, Operation, KeyID) ->
    <<
        "hyperstream-transport@1",
        0,
        Direction/binary,
        0,
        Operation/binary,
        0,
        KeyID/binary
    >>.

decrypt(Key, Nonce, Ciphertext, AAD, Tag) ->
    try
        case crypto:crypto_one_time_aead(
            aes_256_gcm,
            Key,
            Nonce,
            Ciphertext,
            AAD,
            Tag,
            false
        ) of
            error -> {error, authentication_failed};
            Plaintext -> {ok, Plaintext}
        end
    catch
        _:_ -> {error, authentication_failed}
    end.

encoded_length(Bytes) ->
    (Bytes div 3) * 4
        +
            case Bytes rem 3 of
                0 -> 0;
                1 -> 2;
                2 -> 3
            end.

max_request_envelope_bytes() ->
    4
        + 43
        + 1
        + encoded_length(?PUBLIC_KEY_BYTES)
        + 1
        + encoded_length(?NONCE_BYTES)
        + 1
        + encoded_length(?MAX_PLAINTEXT_BYTES + ?TAG_BYTES).

-ifdef(TEST).

key_info_is_flat_and_stable_test() ->
    First = key_info(),
    Second = key_info(),
    ?assertEqual(First, Second),
    ?assertEqual(
        lists:sort([
            <<"algorithm">>,
            <<"device">>,
            <<"key-id">>,
            <<"public-key">>,
            <<"transport">>
        ]),
        lists:sort(maps:keys(First))
    ),
    ?assert(lists:all(fun is_binary/1, maps:values(First))),
    {ok, Public} = decode_exact(
        maps:get(<<"public-key">>, First),
        ?PUBLIC_KEY_BYTES,
        invalid
    ),
    ?assertMatch(<<4, _/binary>>, Public),
    ?assertEqual(
        hb_util:encode(crypto:hash(sha256, Public)),
        maps:get(<<"key-id">>, First)
    ).

request_and_response_round_trip_test() ->
    Operation = <<"signal">>,
    RequestBody = <<"{\"sdp\":\"private-offer\"}">>,
    {RequestEnvelope, ClientPrivate, ClientPublic} =
        client_request(Operation, RequestBody),
    {ok, RequestBody, Context} = open(Operation, RequestEnvelope),
    ResponseBody = <<"{\"accepted\":true}">>,
    {ok, ResponseEnvelope} = seal(Operation, ResponseBody, Context),
    ?assertEqual(
        ResponseBody,
        client_open_response(
            Operation,
            ResponseEnvelope,
            ClientPrivate,
            ClientPublic
        )
    ).

operation_and_tag_tampering_are_rejected_test() ->
    {Envelope, _ClientPrivate, _ClientPublic} =
        client_request(<<"signal">>, <<"secret">>),
    ?assertEqual(
        {error, authentication_failed},
        open(<<"close">>, Envelope)
    ),
    [Prefix, KeyID, ClientPublic, Nonce, EncodedCombined] =
        binary:split(Envelope, <<".">>, [global]),
    {ok, Combined} = decode_canonical(EncodedCombined),
    Last = byte_size(Combined) - 1,
    <<Head:Last/binary, Tail>> = Combined,
    TamperedCombined = <<Head/binary, (Tail bxor 1)>>,
    Tampered = iolist_to_binary([
        Prefix,
        <<".">>,
        KeyID,
        <<".">>,
        ClientPublic,
        <<".">>,
        Nonce,
        <<".">>,
        hb_util:encode(TamperedCombined)
    ]),
    ?assertEqual(
        {error, authentication_failed},
        open(<<"signal">>, Tampered)
    ).

strict_envelope_validation_test() ->
    {Envelope, _ClientPrivate, _ClientPublic} =
        client_request(<<"join">>, <<"{}">>),
    ?assertMatch({ok, <<"{}">>, _}, open(join, Envelope)),
    ?assertEqual(
        {error, invalid_envelope},
        open(join, <<Envelope/binary, ".extra">>)
    ),
    [Prefix, KeyID, ClientPublic, Nonce, Ciphertext] =
        binary:split(Envelope, <<".">>, [global]),
    PaddedClientPublic = <<ClientPublic/binary, "=">>,
    Padded = iolist_to_binary([
        Prefix,
        <<".">>,
        KeyID,
        <<".">>,
        PaddedClientPublic,
        <<".">>,
        Nonce,
        <<".">>,
        Ciphertext
    ]),
    ?assertEqual(
        {error, invalid_client_key},
        open(join, Padded)
    ),
    UnknownKeyID = hb_util:encode(crypto:strong_rand_bytes(?KEY_BYTES)),
    Unknown = iolist_to_binary([
        Prefix,
        <<".">>,
        UnknownKeyID,
        <<".">>,
        ClientPublic,
        <<".">>,
        Nonce,
        <<".">>,
        Ciphertext
    ]),
    ?assertEqual({error, unknown_key}, open(join, Unknown)).

client_request(Operation, Plaintext) ->
    Info = key_info(),
    KeyID = maps:get(<<"key-id">>, Info),
    NodePublic = hb_util:decode(maps:get(<<"public-key">>, Info)),
    {ClientPublic, ClientPrivate} =
        crypto:generate_key(ecdh, secp256r1),
    Shared = crypto:compute_key(
        ecdh,
        NodePublic,
        ClientPrivate,
        secp256r1
    ),
    Key = derive_key(Shared, NodePublic, ClientPublic, KeyID),
    Nonce = crypto:strong_rand_bytes(?NONCE_BYTES),
    {Ciphertext, Tag} = crypto:crypto_one_time_aead(
        aes_256_gcm,
        Key,
        Nonce,
        Plaintext,
        aad(<<"request">>, Operation, KeyID),
        true
    ),
    Envelope =
        <<
            "hs1.",
            KeyID/binary,
            ".",
            (hb_util:encode(ClientPublic))/binary,
            ".",
            (hb_util:encode(Nonce))/binary,
            ".",
            (hb_util:encode(<<Ciphertext/binary, Tag/binary>>))/binary
        >>,
    {Envelope, ClientPrivate, ClientPublic}.

client_open_response(
    Operation,
    Envelope,
    ClientPrivate,
    ClientPublic
) ->
    [<<"hs1r">>, KeyID, EncodedNonce, EncodedCombined] =
        binary:split(Envelope, <<".">>, [global]),
    Info = key_info(),
    NodePublic = hb_util:decode(maps:get(<<"public-key">>, Info)),
    Shared = crypto:compute_key(
        ecdh,
        NodePublic,
        ClientPrivate,
        secp256r1
    ),
    Key = derive_key(Shared, NodePublic, ClientPublic, KeyID),
    Nonce = hb_util:decode(EncodedNonce),
    Combined = hb_util:decode(EncodedCombined),
    CiphertextBytes = byte_size(Combined) - ?TAG_BYTES,
    <<Ciphertext:CiphertextBytes/binary, Tag:?TAG_BYTES/binary>> = Combined,
    crypto:crypto_one_time_aead(
        aes_256_gcm,
        Key,
        Nonce,
        Ciphertext,
        aad(<<"response">>, Operation, KeyID),
        Tag,
        false
    ).

-endif.
