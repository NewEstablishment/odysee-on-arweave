%%% @doc Convert an LBRY channel signing key to the JWK shape `~secret@1.0'
%%% imports. LBRY stores each channel's private key as a PEM-encoded secp256k1
%%% key in the wallet's `certificates' map (`lbry-sdk/lbry/wallet/account.py:567',
%%% via coincurve's `PrivateKey.to_pem'). HyperBEAM's `~secret@1.0' imports keys
%%% as JWK and `ar_wallet:from_json/1' reads secp256k1 keys in the
%%% `{kty:"EC", crv:"secp256k1", x, y, d}' form. This is the one codec piece the
%%% wallet migration needs: everything downstream (import, per-account keying,
%%% signing) already exists.
%%%
%%% secp256k1 is the same curve HyperBEAM signs with, so the imported key is the
%%% user's ACTUAL channel key -- the private scalar is preserved byte for byte,
%%% not a fresh key linked by reference. A migrated account therefore signs as
%%% the same identity it held on LBRY.
%%%
%%% Decryption of the wallet-sync blob (scrypt + AES-CBC, keyed by the user's
%%% sync password) happens upstream -- in the client or a TEE -- so the plaintext
%%% PEM, not the password, is what reaches this converter.
-module(lbry_channel_key).
-export([pem_to_jwk/1]).
-include_lib("public_key/include/public_key.hrl").

%% The secp256k1 named-curve OID, as `public_key' returns it.
-define(SECP256K1_OID, {1, 3, 132, 0, 10}).

%% @doc Convert a PEM-encoded secp256k1 private key (an LBRY channel key) to the
%% JWK binary `ar_wallet:from_json/1' accepts. Raises on a non-secp256k1 key or
%% a malformed PEM -- a wrong-curve key must never be silently imported as if it
%% were a channel key.
pem_to_jwk(Pem) when is_binary(Pem) ->
    [Entry] = public_key:pem_decode(Pem),
    #'ECPrivateKey'{
        privateKey = Priv,
        parameters = {namedCurve, ?SECP256K1_OID},
        publicKey = <<4, X:32/binary, Y:32/binary>>
    } = public_key:pem_entry_decode(Entry),
    Scalar = pad_scalar(Priv),
    hb_json:encode(#{
        <<"kty">> => <<"EC">>,
        <<"crv">> => <<"secp256k1">>,
        <<"x">> => hb_util:encode(X),
        <<"y">> => hb_util:encode(Y),
        <<"d">> => hb_util:encode(Scalar)
    }).

%% @doc Left-pad the private scalar to 32 bytes. DER omits leading zero bytes, so
%% a scalar that happens to start with a zero byte decodes shorter than 32 and
%% must be padded back to the fixed width the JWK and the curve expect.
pad_scalar(Scalar) when byte_size(Scalar) =:= 32 ->
    Scalar;
pad_scalar(Scalar) when byte_size(Scalar) < 32 ->
    Pad = 32 - byte_size(Scalar),
    <<0:(Pad * 8), Scalar/binary>>.
