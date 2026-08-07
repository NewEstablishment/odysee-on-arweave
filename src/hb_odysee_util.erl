%%% @doc Shared helpers for the Odysee source stores and bridge: fixed-length
%%% hex validation and raw-transaction hex extraction from a `transaction_show'
%%% result.
-module(hb_odysee_util).
-export([valid_hex/2, raw_tx_hex/1, local_cache_opts/2]).

%% @doc `Bin' is a binary of `2*ByteLen' hex characters decoding to exactly
%% `ByteLen' bytes.
valid_hex(Bin, ByteLen) when is_binary(Bin), byte_size(Bin) == ByteLen * 2 ->
    try binary:decode_hex(Bin) of
        Decoded -> byte_size(Decoded) == ByteLen
    catch
        _:_ -> false
    end;
valid_hex(_Bin, _ByteLen) ->
    false.

%% @doc Extract the raw transaction hex from a `transaction_show' result.
raw_tx_hex(TxResult) when is_map(TxResult) ->
    case maps:get(<<"hex">>, TxResult, undefined) of
        Hex when is_binary(Hex) -> {ok, Hex};
        _ -> {error, missing_raw_tx_hex}
    end;
raw_tx_hex(_TxResult) ->
    {error, missing_raw_tx_hex}.

%% @doc Merge node and store options for operations against `local-store`.
%% Store-level options take precedence, while `store` is narrowed to the
%% configured local cache so lazy links cannot escape into the remote stack.
local_cache_opts(StoreOpts, Opts) ->
    LocalStore = hb_maps:get(<<"local-store">>, StoreOpts, [], StoreOpts),
    Merged = hb_util:deep_merge(Opts, StoreOpts, Opts),
    Merged#{ <<"store">> => LocalStore }.
