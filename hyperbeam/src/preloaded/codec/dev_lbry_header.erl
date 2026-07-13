%%% @doc The `lbry-header@1.0' codec: verifies LBRY block-header commitments
%%% against the configured MMR header commitment.
%%%
%%% `verify/3' dispatches on the request's `type' key over the TRUSTLESS
%%% commitment classes:
%%%
%%%   `mmr-chunk'       - recompute the 1024 block hashes of a header chunk plus
%%%                       their internal prev-hash linkage, and check that the
%%%                       height-10 subtree root equals the committed chunk id.
%%%   `mmr-membership'  - fold a `(height, block-hash)' proof to the trusted MMR
%%%                       root. `block-hash' is the internal-order MMR leaf hash.
%%%   `mmr-consistency' - validate the old frontier against the trusted snapshot
%%%                       size/root, append validated delta leaf hashes, and
%%%                       re-bag to the proposed new root.
%%%
%%% The TEE/snp-anchored commitment classes (`tee-tail', `mmr-genesis') are
%%% deliberately not implemented here: they require an attestation device that
%%% is not present on this branch.
%%%
%%% Trust root: `mmr-membership' and `mmr-consistency' read the pinned root and
%%% snapshot size from node opts (`lbry-header-root' and
%%% `lbry-header-snapshot-n'). These values define what the verifier trusts and
%%% therefore must not come from the untrusted request.
-module(dev_lbry_header).
-implements(<<"lbry-header@1.0">>).
-export([info/0, verify/3]).
-include_lib("eunit/include/eunit.hrl").
-include("include/hb.hrl").

-define(HEADER_SIZE, 112).
-define(CHUNK_HEADERS, 1024).
-define(CHUNK_SIZE, (?CHUNK_HEADERS * ?HEADER_SIZE)).
-define(MAX_MEMBERSHIP_HASHES, 128).
-define(MAX_FRONTIER_PEAKS, 64).
-define(DEFAULT_MAX_DELTA_LEAVES, 4096).
-define(MAX_SAFE_INTEGER, 16#7FFFFFFFFFFFFFFF).

%% @doc Codec device: `verify' is the only resolved key.
info() ->
    #{ excludes => [<<"keys">>, <<"set">>, <<"set-path">>, <<"remove">>] }.

%% @doc Verify a header commitment, dispatching on the request `type'.
verify(Base, Req, Opts) ->
    safe(fun() ->
        case request_field(<<"type">>, Req, Opts) of
            <<"mmr-chunk">>       -> verify_chunk(Base, Req, Opts);
            <<"mmr-membership">>  -> verify_membership(Base, Req, Opts);
            <<"mmr-consistency">> -> verify_consistency(Base, Req, Opts);
            _                     -> {error, unknown_commitment_type}
        end
    end).

%%% --------------------------------------------------------------------------
%%% mmr-chunk
%%% --------------------------------------------------------------------------

verify_chunk(Base, Req, Opts) ->
    ChunkData = payload_field(<<"chunk-data">>, Base, Opts),
    ChunkRoot = request_field(<<"chunk-root">>, Req, Opts),
    case lists:member(undefined, [ChunkData, ChunkRoot]) of
        true ->
            {error, missing_fields};
        false when not is_binary(ChunkData) ->
            {error, invalid_chunk_data};
        false when byte_size(ChunkData) =/= ?CHUNK_SIZE ->
            {error, invalid_chunk_size};
        false ->
            case normalize_hash(ChunkRoot) of
                {ok, Root} ->
                    Headers = split_headers(ChunkData),
                    BlockHashes = [hb_lbry_mmr:sha256d(H) || H <- Headers],
                    case check_prevhash_linkage(Headers, BlockHashes) of
                        ok ->
                            Computed = hb_lbry_mmr:chunk_subtree_root(BlockHashes),
                            {ok, Computed =:= Root};
                        {error, _} = Error ->
                            Error
                    end;
                Error ->
                    Error
            end
    end.

split_headers(Bin) ->
    [binary:part(Bin, I * ?HEADER_SIZE, ?HEADER_SIZE)
        || I <- lists:seq(0, ?CHUNK_HEADERS - 1)].

%% Check that header[i+1]'s prev_hash (bytes 4..35) == sha256d(header[i]).
%% Header[0]'s prev_hash is not checked (it connects to the prior chunk).
check_prevhash_linkage(Headers, BlockHashes) ->
    Pairs = lists:zip(
        lists:sublist(Headers, 2, ?CHUNK_HEADERS - 1),
        lists:sublist(BlockHashes, 1, ?CHUNK_HEADERS - 1)
    ),
    check_pairs(Pairs, 1).

check_pairs([], _Index) ->
    ok;
check_pairs([{Header, PrevHash} | Rest], Index) ->
    <<_Version:4/binary, ActualPrev:32/binary, _/binary>> = Header,
    case ActualPrev =:= PrevHash of
        true -> check_pairs(Rest, Index + 1);
        false -> {error, {prevhash_mismatch, Index}}
    end.

%%% --------------------------------------------------------------------------
%%% mmr-membership
%%% --------------------------------------------------------------------------

verify_membership(_Base, Req, Opts) ->
    Height      = request_field(<<"height">>, Req, Opts),
    BlockHash   = request_field(<<"block-hash">>, Req, Opts),
    Siblings    = request_field(<<"mmr-proof">>, Req, Opts),
    OtherPeaks  = request_field(<<"mmr-proof-peaks">>, Req, Opts),
    PeakIndex   = request_field(<<"mmr-proof-peak-index">>, Req, Opts),
    TrustedRoot = trusted_field(<<"lbry-header-root">>, Opts),
    N           = trusted_field(<<"lbry-header-snapshot-n">>, Opts),
    Fields = [Height, BlockHash, Siblings, OtherPeaks, PeakIndex, TrustedRoot, N],
    case lists:member(undefined, Fields) of
        true ->
            {error, missing_fields};
        false ->
            case normalize_membership(
                BlockHash, Height, Siblings, OtherPeaks, PeakIndex, N, TrustedRoot
            ) of
                {ok, LeafHash, HeightInt, Proof, NInt, Root} ->
                    {ok, hb_lbry_mmr:verify_membership(
                        LeafHash, HeightInt, Proof, NInt, Root
                    )};
                Error ->
                    Error
            end
    end.

normalize_membership(BlockHash, Height, Siblings, OtherPeaks, PeakIndex, N, Root) ->
    case {
        normalize_hash(BlockHash),
        normalize_non_neg_int(Height),
        normalize_hashes(Siblings, ?MAX_MEMBERSHIP_HASHES, invalid_proof),
        normalize_hashes(OtherPeaks, ?MAX_MEMBERSHIP_HASHES, invalid_proof_peaks),
        normalize_non_neg_int(PeakIndex),
        normalize_non_neg_int(N),
        normalize_hash(Root)
    } of
        {
            {ok, LeafHash},
            {ok, HeightInt},
            {ok, SiblingHashes},
            {ok, PeakHashes},
            {ok, PeakIndexInt},
            {ok, NInt},
            {ok, RootHash}
        } ->
            {ok, LeafHash, HeightInt,
                {SiblingHashes, PeakHashes, PeakIndexInt}, NInt, RootHash};
        Results ->
            first_error(tuple_to_list(Results))
    end.

%%% --------------------------------------------------------------------------
%%% mmr-consistency
%%% --------------------------------------------------------------------------

verify_consistency(_Base, Req, Opts) ->
    OldPeaks    = request_field(<<"old-peaks">>, Req, Opts),
    DeltaLeaves = request_field(<<"delta-leaves">>, Req, Opts),
    ToRoot      = request_field(<<"to-root">>, Req, Opts),
    FromRoot    = trusted_field(<<"lbry-header-root">>, Opts),
    FromN       = trusted_field(<<"lbry-header-snapshot-n">>, Opts),
    MaxDelta    = trusted_field(
        <<"lbry-header-max-delta-leaves">>,
        Opts,
        ?DEFAULT_MAX_DELTA_LEAVES
    ),
    Fields = [OldPeaks, DeltaLeaves, ToRoot, FromRoot, FromN, MaxDelta],
    case lists:member(undefined, Fields) of
        true ->
            {error, missing_fields};
        false ->
            case normalize_consistency(
                FromRoot, FromN, OldPeaks, DeltaLeaves, ToRoot, MaxDelta
            ) of
                {ok, FromRootHash, FromNInt, Peaks, Leaves, ToRootHash} ->
                    {ok, hb_lbry_mmr:verify_consistency(
                        FromRootHash, FromNInt, Peaks, Leaves, ToRootHash
                    )};
                Error ->
                    Error
            end
    end.

normalize_consistency(FromRoot, FromN, OldPeaks, DeltaLeaves, ToRoot, MaxDelta) ->
    case normalize_non_neg_int(MaxDelta) of
        {ok, MaxDeltaInt} when MaxDeltaInt > 0 ->
            case {
                normalize_hash(FromRoot),
                normalize_non_neg_int(FromN),
                normalize_peaks(OldPeaks, ?MAX_FRONTIER_PEAKS),
                normalize_hashes(DeltaLeaves, MaxDeltaInt, delta_too_large),
                normalize_hash(ToRoot)
            } of
                {
                    {ok, FromRootHash},
                    {ok, FromNInt},
                    {ok, Peaks},
                    {ok, Leaves},
                    {ok, ToRootHash}
                } ->
                    {ok, FromRootHash, FromNInt, Peaks, Leaves, ToRootHash};
                Results ->
                    first_error(tuple_to_list(Results))
            end;
        _ ->
            {error, invalid_max_delta_leaves}
    end.

%%% --------------------------------------------------------------------------
%%% Boundary helpers
%%% --------------------------------------------------------------------------

safe(Fun) ->
    try Fun()
    catch
        _:_ -> {error, invalid_input}
    end.

request_field(Key, Req, Opts) ->
    hb_maps:get(Key, Req, undefined, Opts).

payload_field(Key, Base, Opts) ->
    hb_maps:get(Key, Base, undefined, Opts).

trusted_field(Key, Opts) ->
    trusted_field(Key, Opts, undefined).

trusted_field(Key, Opts, Default) ->
    hb_maps:get(Key, Opts, Default, Opts).

normalize_hash(Hash) when is_binary(Hash), byte_size(Hash) =:= 32 ->
    {ok, Hash};
normalize_hash(Hash) when is_binary(Hash), byte_size(Hash) =:= 64 ->
    try
        {ok, binary:decode_hex(Hash)}
    catch
        _:_ -> {error, invalid_hash}
    end;
normalize_hash(_Hash) ->
    {error, invalid_hash}.

normalize_non_neg_int(Value) ->
    case hb_util:safe_int(Value) of
        {ok, Int} when Int >= 0, Int =< ?MAX_SAFE_INTEGER -> {ok, Int};
        _ -> {error, invalid_integer}
    end.

normalize_hashes(Values, Limit, LimitError) when is_list(Values) ->
    normalize_hashes(Values, Limit, LimitError, []);
normalize_hashes(_Values, _Limit, _LimitError) ->
    {error, invalid_hash_list}.

normalize_hashes([], _Remaining, _LimitError, Acc) ->
    {ok, lists:reverse(Acc)};
normalize_hashes([_Value | _Rest], 0, LimitError, _Acc) ->
    {error, LimitError};
normalize_hashes([Value | Rest], Remaining, LimitError, Acc) ->
    case normalize_hash(Value) of
        {ok, Hash} ->
            normalize_hashes(Rest, Remaining - 1, LimitError, [Hash | Acc]);
        Error ->
            Error
    end.

normalize_peaks(Peaks, Limit) when is_list(Peaks) ->
    normalize_peaks(Peaks, Limit, []);
normalize_peaks(_Peaks, _Limit) ->
    {error, invalid_peak_list}.

normalize_peaks([], _Remaining, Acc) ->
    {ok, lists:reverse(Acc)};
normalize_peaks([_Peak | _Rest], 0, _Acc) ->
    {error, peak_list_too_large};
normalize_peaks([Peak | Rest], Remaining, Acc) ->
    case normalize_peak(Peak) of
        {ok, Normalized} -> normalize_peaks(Rest, Remaining - 1, [Normalized | Acc]);
        Error -> Error
    end.

normalize_peak({Height, Hash}) ->
    normalize_peak_pair(Height, Hash);
normalize_peak([Height, Hash]) ->
    normalize_peak_pair(Height, Hash);
normalize_peak(_Peak) ->
    {error, invalid_peak}.

normalize_peak_pair(Height, Hash) ->
    case {normalize_non_neg_int(Height), normalize_hash(Hash)} of
        {{ok, HeightInt}, {ok, HashBin}} -> {ok, {HeightInt, HashBin}};
        Results -> first_error(tuple_to_list(Results))
    end.

first_error([]) ->
    {error, invalid_input};
first_error([{ok, _Value} | Rest]) ->
    first_error(Rest);
first_error([Error | _Rest]) ->
    Error.

%%% --------------------------------------------------------------------------
%%% Tests (network-free)
%%% --------------------------------------------------------------------------
-ifdef(TEST).

-define(FIXTURE, "test/fixtures/lbry/").

read_fixture(Name) ->
    {ok, Bin} = file:read_file(?FIXTURE ++ Name),
    Bin.

read_eterm(Name) ->
    {ok, [Term]} = file:consult(?FIXTURE ++ Name),
    Term.

verify_chunk_test() ->
    Base = #{ <<"chunk-data">> => read_fixture("chunk0.bin") },
    Req = #{
        <<"type">> => <<"mmr-chunk">>,
        <<"chunk-root">> =>
            <<"7621d56d4aec31d0c874008dec0e12b04d0b863546ccbf21c47e872f43a519e4">>
    },
    ?assertEqual({ok, true}, verify(Base, Req, #{})).

verify_chunk_wrong_root_test() ->
    Base = #{ <<"chunk-data">> => read_fixture("chunk0.bin") },
    Req = #{
        <<"type">> => <<"mmr-chunk">>,
        <<"chunk-root">> => binary:copy(<<$0>>, 64)
    },
    ?assertEqual({ok, false}, verify(Base, Req, #{})).

verify_chunk_invalid_size_test() ->
    Base = #{ <<"chunk-data">> => <<"tooshort">> },
    Req = #{
        <<"type">> => <<"mmr-chunk">>,
        <<"chunk-root">> => binary:copy(<<$0>>, 64)
    },
    ?assertEqual({error, invalid_chunk_size}, verify(Base, Req, #{})).

verify_chunk_ignores_request_payload_test() ->
    Req = #{
        <<"type">> => <<"mmr-chunk">>,
        <<"chunk-data">> => read_fixture("chunk0.bin"),
        <<"chunk-root">> => binary:copy(<<$0>>, 64)
    },
    ?assertEqual({error, missing_fields}, verify(#{}, Req, #{})).

membership_fixture() ->
    Proof = read_eterm("mmr_proof_2058011.eterm"),
    Req = #{
        <<"type">> => <<"mmr-membership">>,
        <<"height">> => maps:get(height, Proof),
        <<"block-hash">> => maps:get(leaf_hash, Proof),
        <<"mmr-proof">> => maps:get(siblings, Proof),
        <<"mmr-proof-peaks">> => maps:get(other_peaks, Proof),
        <<"mmr-proof-peak-index">> => maps:get(peak_index, Proof)
    },
    Opts = #{
        <<"lbry-header-root">> => maps:get(root, Proof),
        <<"lbry-header-snapshot-n">> => maps:get(n, Proof)
    },
    {Proof, Req, Opts}.

verify_membership_real_test() ->
    {_Proof, Req, Opts} = membership_fixture(),
    ?assertEqual({ok, true}, verify(#{}, Req, Opts)).

verify_membership_tampered_test() ->
    {Proof, Req, Opts} = membership_fixture(),
    [First | Rest] = maps:get(siblings, Proof),
    <<Byte, Tail/binary>> = binary:decode_hex(First),
    Flipped = binary:encode_hex(<<(Byte bxor 1), Tail/binary>>, lowercase),
    ?assertEqual(
        {ok, false},
        verify(#{}, Req#{ <<"mmr-proof">> => [Flipped | Rest] }, Opts)
    ).

verify_membership_rejects_root_as_leaf_test() ->
    {_Proof, Req, Opts} = membership_fixture(),
    Root = maps:get(<<"lbry-header-root">>, Opts),
    Forged = Req#{
        <<"block-hash">> => Root,
        <<"mmr-proof">> => [],
        <<"mmr-proof-peaks">> => [],
        <<"mmr-proof-peak-index">> => 0
    },
    ?assertEqual({ok, false}, verify(#{}, Forged, Opts)).

verify_membership_rejects_bad_shape_test() ->
    {_Proof, Req, Opts} = membership_fixture(),
    ?assertEqual(
        {ok, false},
        verify(#{}, Req#{ <<"mmr-proof">> => [] }, Opts)
    ),
    ?assertEqual(
        {ok, false},
        verify(#{}, Req#{ <<"mmr-proof-peak-index">> => 0 }, Opts)
    ).

verify_membership_invalid_input_test() ->
    {_Proof, Req, Opts} = membership_fixture(),
    ?assertEqual(
        {error, invalid_integer},
        verify(#{}, Req#{ <<"height">> => <<"not-a-number">> }, Opts)
    ),
    ?assertEqual(
        {error, invalid_hash_list},
        verify(#{}, Req#{ <<"mmr-proof">> => not_a_list }, Opts)
    ),
    ?assertEqual(
        {error, invalid_hash},
        verify(#{}, Req#{ <<"block-hash">> => <<"short">> }, Opts)
    ).

verify_membership_reads_request_only_test() ->
    {_Proof, Req, Opts} = membership_fixture(),
    Base = Req,
    ?assertEqual(
        {error, missing_fields},
        verify(Base, #{ <<"type">> => <<"mmr-membership">> }, Opts)
    ).

consistency_fixture() ->
    Chunk0 = read_fixture("chunk0.bin"),
    Leaves = [hb_lbry_mmr:sha256d(binary:part(Chunk0, I * ?HEADER_SIZE, ?HEADER_SIZE))
        || I <- lists:seq(0, 6)],
    {Old, Delta} = lists:split(4, Leaves),
    OldPeaks = lists:foldl(fun(Leaf, Peaks) -> hb_lbry_mmr:mmr_append(Peaks, Leaf) end, [], Old),
    FromRoot = hb_lbry_mmr:bag_peaks([Hash || {_Height, Hash} <- OldPeaks]),
    ToRoot = hb_lbry_mmr:mmr_root(Leaves),
    {FromRoot, length(Old), OldPeaks, Delta, ToRoot}.

consistency_request(OldPeaks, Delta, ToRoot) ->
    #{
        <<"type">> => <<"mmr-consistency">>,
        <<"old-peaks">> => OldPeaks,
        <<"delta-leaves">> => Delta,
        <<"to-root">> => ToRoot
    }.

consistency_opts(FromRoot, FromN) ->
    #{
        <<"lbry-header-root">> => FromRoot,
        <<"lbry-header-snapshot-n">> => FromN
    }.

verify_consistency_test() ->
    {FromRoot, FromN, OldPeaks, Delta, ToRoot} = consistency_fixture(),
    ?assertEqual(
        {ok, true},
        verify(#{}, consistency_request(OldPeaks, Delta, ToRoot),
            consistency_opts(FromRoot, FromN))
    ).

verify_consistency_wrong_to_root_test() ->
    {FromRoot, FromN, OldPeaks, Delta, _ToRoot} = consistency_fixture(),
    ?assertEqual(
        {ok, false},
        verify(#{}, consistency_request(OldPeaks, Delta, hb_lbry_mmr:sha256d(<<"bad">>)),
            consistency_opts(FromRoot, FromN))
    ).

verify_consistency_rejects_forged_frontier_test() ->
    {FromRoot, FromN, _OldPeaks, Delta, _ToRoot} = consistency_fixture(),
    ForgedPeaks = [{0, FromRoot}],
    ForgedNewPeaks = lists:foldl(
        fun(Leaf, Peaks) -> hb_lbry_mmr:mmr_append(Peaks, Leaf) end,
        ForgedPeaks,
        Delta
    ),
    ForgedRoot = hb_lbry_mmr:bag_peaks([Hash || {_Height, Hash} <- ForgedNewPeaks]),
    ?assertEqual(
        {ok, false},
        verify(#{}, consistency_request(ForgedPeaks, Delta, ForgedRoot),
            consistency_opts(FromRoot, FromN))
    ).

verify_consistency_requires_snapshot_size_test() ->
    {FromRoot, _FromN, OldPeaks, Delta, ToRoot} = consistency_fixture(),
    ?assertEqual(
        {error, missing_fields},
        verify(#{}, consistency_request(OldPeaks, Delta, ToRoot),
            #{ <<"lbry-header-root">> => FromRoot })
    ).

verify_consistency_enforces_delta_limit_test() ->
    {FromRoot, FromN, OldPeaks, Delta, ToRoot} = consistency_fixture(),
    Opts = (consistency_opts(FromRoot, FromN))#{
        <<"lbry-header-max-delta-leaves">> => 1
    },
    ?assertEqual(
        {error, delta_too_large},
        verify(#{}, consistency_request(OldPeaks, Delta, ToRoot), Opts)
    ).

verify_consistency_malformed_input_test() ->
    {FromRoot, FromN, _OldPeaks, Delta, ToRoot} = consistency_fixture(),
    ?assertEqual(
        {error, invalid_peak_list},
        verify(#{}, consistency_request(not_a_list, Delta, ToRoot),
            consistency_opts(FromRoot, FromN))
    ).

unknown_type_test() ->
    ?assertEqual(
        {error, unknown_commitment_type},
        verify(#{ <<"type">> => <<"mmr-membership">> },
            #{ <<"type">> => <<"tee-tail">> }, #{})
    ).

-endif.
