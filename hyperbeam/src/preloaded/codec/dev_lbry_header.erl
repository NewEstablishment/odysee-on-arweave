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
%%%                       root. `block-hash' is the internal-order MMR leaf hash,
%%%                       not LBRY/Bitcoin display order.
%%%   `mmr-consistency' - bag the old peaks to the old root, append the provided
%%%                       (independently validated) delta leaves, and re-bag to
%%%                       the new root.
%%%   `mmr-block-inclusion'
%%%                     - verify a transaction branch to a block header, then
%%%                       verify that header against the trusted MMR root.
%%%
%%% The TEE/snp-anchored commitment classes (`tee-tail', `mmr-genesis') are
%%% deliberately not implemented here: they require an attestation device that
%%% is not present on this branch.
%%%
%%% Trust root: `mmr-membership' and `mmr-consistency' read the pinned root from
%%% node opts (`lbry-header-root' / `lbry-header-snapshot-n'). A codec reading
%%% node opts is normally flagged, but the commitment's trust anchor is the
%%% permitted exception: the verifier-pinned root is exactly the configuration
%%% that defines what "valid" means, and must come from the node, not the
%%% (untrusted) message under verification.
-module(dev_lbry_header).
-implements(<<"lbry-header@1.0">>).
-export([info/0, verify/3]).
-include_lib("eunit/include/eunit.hrl").
-include("include/hb.hrl").

-define(HEADER_SIZE, 112).
-define(CHUNK_HEADERS, 1024).
-define(CHUNK_SIZE, (?CHUNK_HEADERS * ?HEADER_SIZE)).

%% @doc Codec device: `verify' is the only resolved key.
info() ->
    #{ excludes => [<<"keys">>, <<"set">>, <<"set-path">>, <<"remove">>] }.

%% @doc Verify a header commitment, dispatching on the request `type'.
verify(Base, Req, Opts) ->
    safe(fun() ->
        case request_field(<<"type">>, Req, Opts) of
            <<"mmr-chunk">>           -> verify_chunk(Base, Req, Opts);
            <<"mmr-membership">>      -> verify_membership(Base, Req, Opts);
            <<"mmr-consistency">>     -> verify_consistency(Base, Req, Opts);
            <<"mmr-block-inclusion">> -> verify_block_inclusion(Base, Req, Opts);
            _                         -> {error, unknown_commitment_type}
        end
    end).

%%% --------------------------------------------------------------------------
%%% mmr-chunk
%%% --------------------------------------------------------------------------

verify_chunk(Base, Req, Opts) ->
    ChunkData = payload_field(<<"chunk-data">>, Base, Req, Opts),
    ChunkRoot = request_field(<<"chunk-root">>, Req, Opts),
    case lists:member(undefined, [ChunkData, ChunkRoot]) of
        true -> {error, missing_fields};
        false when not is_binary(ChunkData) ->
            {error, invalid_chunk_data};
        false ->
            case byte_size(ChunkData) of
                ?CHUNK_SIZE ->
                    verify_chunk_root(ChunkData, ChunkRoot);
                _ ->
                    {error, invalid_chunk_size}
            end
    end.

verify_chunk_root(ChunkData, ChunkRoot) ->
    case normalize_internal_hash(ChunkRoot) of
        {ok, Root} ->
            Headers = split_headers(ChunkData),
            BlockHashes = [hb_lbry_mmr:sha256d(H) || H <- Headers],
            case check_prevhash_linkage(Headers, BlockHashes) of
                ok ->
                    Computed = hb_lbry_mmr:chunk_subtree_root(BlockHashes),
                    {ok, Computed =:= Root};
                {error, _} = Err ->
                    Err
            end;
        Error ->
            Error
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

check_pairs([], _Idx) -> ok;
check_pairs([{Header, PrevHash} | Rest], Idx) ->
    <<_Version:4/binary, ActualPrev:32/binary, _/binary>> = Header,
    case ActualPrev =:= PrevHash of
        true  -> check_pairs(Rest, Idx + 1);
        false -> {error, {prevhash_mismatch, Idx}}
    end.

%%% --------------------------------------------------------------------------
%%% mmr-membership
%%% --------------------------------------------------------------------------

verify_membership(_Base, Req, Opts) ->
    Height     = request_field(<<"height">>,               Req, Opts),
    BlockHash  = request_field(<<"block-hash">>,           Req, Opts),
    Siblings   = request_field(<<"mmr-proof">>,            Req, Opts),
    OtherPeaks = request_field(<<"mmr-proof-peaks">>,      Req, Opts),
    PeakIndex  = request_field(<<"mmr-proof-peak-index">>, Req, Opts),
    TrustedRoot = hb_maps:get(<<"lbry-header-root">>,        Opts, undefined, Opts),
    N           = hb_maps:get(<<"lbry-header-snapshot-n">>,  Opts, undefined, Opts),
    Fields = [Height, BlockHash, Siblings, OtherPeaks, PeakIndex, TrustedRoot, N],
    case lists:member(undefined, Fields) of
        true -> {error, missing_fields};
        false ->
            case normalize_membership(BlockHash, Height, Siblings, OtherPeaks,
                    PeakIndex, N, TrustedRoot) of
                {ok, LeafHash, HeightInt, Proof, NInt, Root} ->
                    {ok,
                        hb_lbry_mmr:verify_membership(
                            LeafHash,
                            HeightInt,
                            Proof,
                            NInt,
                            Root
                        )
                    };
                Error ->
                    Error
            end
    end.

%%% --------------------------------------------------------------------------
%%% mmr-consistency
%%% --------------------------------------------------------------------------

verify_consistency(_Base, Req, Opts) ->
    OldPeaks    = request_field(<<"old-peaks">>,    Req, Opts),
    DeltaLeaves = request_field(<<"delta-leaves">>, Req, Opts),
    ToRoot      = request_field(<<"to-root">>,      Req, Opts),
    FromRoot    = hb_maps:get(<<"lbry-header-root">>,       Opts, undefined, Opts),
    FromN       = hb_maps:get(<<"lbry-header-snapshot-n">>, Opts, undefined, Opts),
    case lists:member(undefined, [OldPeaks, DeltaLeaves, ToRoot, FromRoot, FromN]) of
        true -> {error, missing_fields};
        false ->
            case normalize_consistency(FromRoot, FromN, OldPeaks, DeltaLeaves, ToRoot) of
                {ok, FromRootHash, FromNInt, Peaks, Leaves, ToRootHash} ->
                    {ok,
                        hb_lbry_mmr:verify_consistency(
                            FromRootHash,
                            FromNInt,
                            Peaks,
                            Leaves,
                            ToRootHash
                        )
                    };
                Error ->
                    Error
            end
    end.

%%% --------------------------------------------------------------------------
%%% mmr-block-inclusion
%%% --------------------------------------------------------------------------

verify_block_inclusion(Base, Req, Opts) ->
    RawTx       = payload_field(<<"raw">>,    Base, Req, Opts),
    Header      = payload_field(<<"header">>, Base, Req, Opts),
    TxID        = request_field(<<"txid">>,                Req, Opts),
    Branch      = request_field(<<"branch">>,              Req, Opts),
    Position    = request_field(<<"position">>,            Req, Opts),
    Height      = request_field(<<"height">>,              Req, Opts),
    Siblings    = request_field(<<"mmr-proof">>,           Req, Opts),
    OtherPeaks  = request_field(<<"mmr-proof-peaks">>,     Req, Opts),
    PeakIndex   = request_field(<<"mmr-proof-peak-index">>, Req, Opts),
    TrustedRoot = hb_maps:get(<<"lbry-header-root">>,       Opts, undefined, Opts),
    N           = hb_maps:get(<<"lbry-header-snapshot-n">>, Opts, undefined, Opts),
    Fields = [RawTx, Header, TxID, Branch, Position, Height, Siblings,
        OtherPeaks, PeakIndex, TrustedRoot, N],
    case lists:member(undefined, Fields) of
        true -> {error, missing_fields};
        false ->
            verify_block_inclusion_fields(
                RawTx,
                Header,
                TxID,
                Branch,
                Position,
                Height,
                Siblings,
                OtherPeaks,
                PeakIndex,
                N,
                TrustedRoot
            )
    end.

verify_block_inclusion_fields(RawTx, Header, TxID, Branch, Position, Height,
        Siblings, OtherPeaks, PeakIndex, N, TrustedRoot) ->
    case normalize_block_inclusion(RawTx, Header, TxID, Branch, Position,
            Height, Siblings, OtherPeaks, PeakIndex, N, TrustedRoot) of
        {ok, RawTxBin, HeaderBin, TxIDHash, BranchHashes, PositionInt,
                HeightInt, Proof, NInt, Root} ->
            TxHash = hb_lbry_mmr:sha256d(RawTxBin),
            HeaderHash = hb_lbry_mmr:sha256d(HeaderBin),
            <<_Prefix:36/binary, HeaderMerkleRoot:32/binary, _Rest/binary>> = HeaderBin,
            FoldedRoot = hb_lbry_mmr:merkle_fold(TxHash, BranchHashes, PositionInt),
            {ok,
                TxHash =:= TxIDHash
                    andalso FoldedRoot =:= HeaderMerkleRoot
                    andalso hb_lbry_mmr:verify_membership(
                        HeaderHash,
                        HeightInt,
                        Proof,
                        NInt,
                        Root
                    )
            };
        Error ->
            Error
    end.

%%% --------------------------------------------------------------------------
%%% Helpers
%%% --------------------------------------------------------------------------

safe(Fun) ->
    try Fun()
    catch _:_ -> {error, invalid_input}
    end.

request_field(Key, Req, Opts) ->
    hb_maps:get(Key, Req, undefined, Opts).

payload_field(Key, Base, _Req, Opts) ->
    hb_maps:get(Key, Base, undefined, Opts).

normalize_membership(BlockHash, Height, Siblings, OtherPeaks, PeakIndex, N, Root) ->
    case {normalize_internal_hash(BlockHash),
            normalize_non_neg_int(Height),
            normalize_hashes(Siblings, fun normalize_internal_hash/1),
            normalize_hashes(OtherPeaks, fun normalize_internal_hash/1),
            normalize_non_neg_int(PeakIndex),
            normalize_non_neg_int(N),
            normalize_internal_hash(Root)} of
        {{ok, BlockHashBin}, {ok, HeightInt}, {ok, SiblingHashes}, {ok, PeakHashes},
                {ok, PeakIndexInt}, {ok, NInt}, {ok, RootHash}} ->
            {ok, BlockHashBin, HeightInt, {SiblingHashes, PeakHashes, PeakIndexInt},
                NInt, RootHash};
        Tuple ->
            first_error(tuple_to_list(Tuple))
    end.

normalize_consistency(FromRoot, FromN, OldPeaks, DeltaLeaves, ToRoot) ->
    case {normalize_internal_hash(FromRoot),
            normalize_non_neg_int(FromN),
            normalize_peaks(OldPeaks),
            normalize_hashes(DeltaLeaves, fun normalize_internal_hash/1),
            normalize_internal_hash(ToRoot)} of
        {{ok, FromRootHash}, {ok, FromNInt}, {ok, Peaks}, {ok, Leaves}, {ok, ToRootHash}} ->
            {ok, FromRootHash, FromNInt, Peaks, Leaves, ToRootHash};
        Tuple ->
            first_error(tuple_to_list(Tuple))
    end.

normalize_block_inclusion(RawTx, Header, TxID, Branch, Position, Height,
        Siblings, OtherPeaks, PeakIndex, N, Root) ->
    case {normalize_tx(RawTx),
            normalize_header(Header),
            normalize_display_hash(TxID),
            normalize_hashes(Branch, fun normalize_display_hash/1),
            normalize_non_neg_int(Position),
            normalize_non_neg_int(Height),
            normalize_hashes(Siblings, fun normalize_internal_hash/1),
            normalize_hashes(OtherPeaks, fun normalize_internal_hash/1),
            normalize_non_neg_int(PeakIndex),
            normalize_non_neg_int(N),
            normalize_internal_hash(Root)} of
        {{ok, RawTxBin}, {ok, HeaderBin}, {ok, TxIDHash}, {ok, BranchHashes},
                {ok, PositionInt}, {ok, HeightInt}, {ok, SiblingHashes}, {ok, PeakHashes},
                {ok, PeakIndexInt}, {ok, NInt}, {ok, RootHash}} ->
            {ok, RawTxBin, HeaderBin, TxIDHash, BranchHashes, PositionInt,
                HeightInt, {SiblingHashes, PeakHashes, PeakIndexInt}, NInt, RootHash};
        Tuple ->
            first_error(tuple_to_list(Tuple))
    end.

normalize_tx(Bin) when is_binary(Bin) ->
    case decode_bytes(Bin) of
        {ok, Decoded} -> {ok, Decoded};
        {error, invalid_hex} -> {ok, Bin}
    end;
normalize_tx(_Value) ->
    {error, invalid_tx}.

normalize_header(Header) when is_binary(Header), byte_size(Header) =:= ?HEADER_SIZE ->
    {ok, Header};
normalize_header(Header) when is_binary(Header) ->
    case decode_bytes(Header) of
        {ok, Decoded} when byte_size(Decoded) =:= ?HEADER_SIZE -> {ok, Decoded};
        _ -> {error, invalid_header}
    end;
normalize_header(_Header) ->
    {error, invalid_header}.

normalize_internal_hash(H) when is_binary(H), byte_size(H) =:= 32 ->
    {ok, H};
normalize_internal_hash(H) when is_binary(H), byte_size(H) =:= 64 ->
    decode_hash(H);
normalize_internal_hash(_H) ->
    {error, invalid_hash}.

normalize_display_hash(H) when is_binary(H), byte_size(H) =:= 32 ->
    {ok, H};
normalize_display_hash(H) when is_binary(H), byte_size(H) =:= 64 ->
    case decode_hash(H) of
        {ok, Hash} -> {ok, reverse_binary(Hash)};
        Error -> Error
    end;
normalize_display_hash(_H) ->
    {error, invalid_hash}.

decode_hash(H) ->
    try
        {ok, binary:decode_hex(H)}
    catch _:_ ->
        {error, invalid_hash}
    end.

decode_bytes(Bin) ->
    try
        {ok, binary:decode_hex(Bin)}
    catch _:_ ->
        {error, invalid_hex}
    end.

reverse_binary(Bin) ->
    list_to_binary(lists:reverse(binary:bin_to_list(Bin))).

normalize_non_neg_int(Value) ->
    case hb_util:safe_int(Value) of
        {ok, Int} when Int >= 0 -> {ok, Int};
        _ -> {error, invalid_integer}
    end.

normalize_hashes(Values, Decoder) when is_list(Values) ->
    normalize_hashes(Values, Decoder, []);
normalize_hashes(_Values, _Decoder) ->
    {error, invalid_hash_list}.

normalize_hashes([], _Decoder, Acc) ->
    {ok, lists:reverse(Acc)};
normalize_hashes([Value | Rest], Decoder, Acc) ->
    case Decoder(Value) of
        {ok, Hash} -> normalize_hashes(Rest, Decoder, [Hash | Acc]);
        Error -> Error
    end.

normalize_peaks(Peaks) when is_list(Peaks) ->
    normalize_peaks(Peaks, []);
normalize_peaks(_Peaks) ->
    {error, invalid_peak_list}.

normalize_peaks([], Acc) ->
    {ok, lists:reverse(Acc)};
normalize_peaks([Peak | Rest], Acc) ->
    case normalize_peak(Peak) of
        {ok, Normalized} -> normalize_peaks(Rest, [Normalized | Acc]);
        Error -> Error
    end.

normalize_peak({H, Hash}) ->
    normalize_peak_pair(H, Hash);
normalize_peak([H, Hash]) ->
    normalize_peak_pair(H, Hash);
normalize_peak(_Peak) ->
    {error, invalid_peak}.

normalize_peak_pair(H, Hash) ->
    case {normalize_non_neg_int(H), normalize_internal_hash(Hash)} of
        {{ok, Height}, {ok, HashBin}} -> {ok, {Height, HashBin}};
        Tuple -> first_error(tuple_to_list(Tuple))
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
    Base = #{
        <<"chunk-data">> => read_fixture("chunk0.bin")
    },
    Req = #{
        <<"type">> => <<"mmr-chunk">>,
        <<"chunk-root">> =>
            <<"7621d56d4aec31d0c874008dec0e12b04d0b863546ccbf21c47e872f43a519e4">>
    },
    ?assertEqual({ok, true}, verify(Base, Req, #{})).

verify_chunk_wrong_root_test() ->
    Base = #{
        <<"chunk-data">> => read_fixture("chunk0.bin")
    },
    Req = #{
        <<"type">> => <<"mmr-chunk">>,
        <<"chunk-root">> => binary:copy(<<$0>>, 64)
    },
    ?assertEqual({ok, false}, verify(Base, Req, #{})).

verify_chunk_invalid_size_test() ->
    Base = #{
        <<"chunk-data">> => <<"tooshort">>
    },
    Req = #{
        <<"type">>       => <<"mmr-chunk">>,
        <<"chunk-root">> => binary:copy(<<$0>>, 64)
    },
    ?assertEqual({error, invalid_chunk_size}, verify(Base, Req, #{})).

verify_chunk_invalid_input_test() ->
    Base = #{
        <<"chunk-data">> => 1
    },
    Req = #{
        <<"type">>       => <<"mmr-chunk">>,
        <<"chunk-root">> => binary:copy(<<$0>>, 64)
    },
    ?assertEqual({error, invalid_chunk_data}, verify(Base, Req, #{})).

verify_chunk_ignores_request_payload_test() ->
    Req = #{
        <<"type">>       => <<"mmr-chunk">>,
        <<"chunk-data">> => read_fixture("chunk0.bin"),
        <<"chunk-root">> =>
            <<"7621d56d4aec31d0c874008dec0e12b04d0b863546ccbf21c47e872f43a519e4">>
    },
    ?assertEqual({error, missing_fields}, verify(#{}, Req, #{})).

membership_fixture() ->
    P = read_eterm("mmr_proof_2058011.eterm"),
    Req = #{
        <<"type">>                 => <<"mmr-membership">>,
        <<"height">>               => maps:get(height, P),
        <<"block-hash">>           => maps:get(leaf_hash, P),
        <<"mmr-proof">>            => maps:get(siblings, P),
        <<"mmr-proof-peaks">>      => maps:get(other_peaks, P),
        <<"mmr-proof-peak-index">> => maps:get(peak_index, P)
    },
    Opts = #{
        <<"lbry-header-root">>       => maps:get(root, P),
        <<"lbry-header-snapshot-n">> => maps:get(n, P)
    },
    {P, Req, Opts}.

verify_membership_real_test() ->
    {_P, Req, Opts} = membership_fixture(),
    ?assertEqual({ok, true}, verify(#{}, Req, Opts)).

verify_membership_tampered_test() ->
    {P, Req, Opts} = membership_fixture(),
    [First | Rest] = maps:get(siblings, P),
    <<Byte, Tail/binary>> = binary:decode_hex(First),
    Flipped = binary:encode_hex(<<(Byte bxor 1), Tail/binary>>, lowercase),
    ?assertEqual(
        {ok, false},
        verify(#{}, Req#{<<"mmr-proof">> => [Flipped | Rest]}, Opts)).

verify_membership_bad_peak_index_test() ->
    {_P, Req, Opts} = membership_fixture(),
    ?assertEqual(
        {ok, false},
        verify(#{}, Req#{<<"mmr-proof-peak-index">> => 99}, Opts)).

verify_membership_invalid_integer_test() ->
    {_P, Req, Opts} = membership_fixture(),
    ?assertEqual(
        {error, invalid_integer},
        verify(#{}, Req#{<<"height">> => <<"not-a-number">>}, Opts)).

consistency_fixture() ->
    Chunk0 = read_fixture("chunk0.bin"),
    Leaves = [hb_lbry_mmr:sha256d(binary:part(Chunk0, I * 112, 112))
                || I <- lists:seq(0, 6)],
    {Old, Delta} = lists:split(4, Leaves),
    OldPeaks = lists:foldl(fun(L, A) -> hb_lbry_mmr:mmr_append(A, L) end, [], Old),
    FromRoot = hb_lbry_mmr:bag_peaks([Pk || {_, Pk} <- OldPeaks]),
    ToRoot = hb_lbry_mmr:mmr_root(Leaves),
    {FromRoot, length(Old), OldPeaks, Delta, ToRoot}.

verify_consistency_test() ->
    {FromRoot, FromN, OldPeaks, Delta, ToRoot} = consistency_fixture(),
    Req = #{
        <<"type">>         => <<"mmr-consistency">>,
        <<"old-peaks">>    => OldPeaks,
        <<"delta-leaves">> => Delta,
        <<"to-root">>      => ToRoot
    },
    Opts = #{<<"lbry-header-root">> => FromRoot, <<"lbry-header-snapshot-n">> => FromN},
    ?assertEqual({ok, true}, verify(#{}, Req, Opts)).

verify_consistency_wrong_to_root_test() ->
    {FromRoot, FromN, OldPeaks, Delta, _ToRoot} = consistency_fixture(),
    Req = #{
        <<"type">>         => <<"mmr-consistency">>,
        <<"old-peaks">>    => OldPeaks,
        <<"delta-leaves">> => Delta,
        <<"to-root">>      => hb_lbry_mmr:sha256d(<<"bad">>)
    },
    Opts = #{<<"lbry-header-root">> => FromRoot, <<"lbry-header-snapshot-n">> => FromN},
    ?assertEqual({ok, false}, verify(#{}, Req, Opts)).

verify_consistency_rejects_noncanonical_peaks_test() ->
    {FromRoot, FromN, _OldPeaks, Delta, _ToRoot} = consistency_fixture(),
    ForgedOldPeaks = [{0, FromRoot}],
    ForgedNewPeaks =
        lists:foldl(fun(X, Acc) -> hb_lbry_mmr:mmr_append(Acc, X) end, ForgedOldPeaks, Delta),
    ForgedToRoot = hb_lbry_mmr:bag_peaks([P || {_H, P} <- ForgedNewPeaks]),
    Req = #{
        <<"type">>         => <<"mmr-consistency">>,
        <<"old-peaks">>    => ForgedOldPeaks,
        <<"delta-leaves">> => Delta,
        <<"to-root">>      => ForgedToRoot
    },
    Opts = #{<<"lbry-header-root">> => FromRoot, <<"lbry-header-snapshot-n">> => FromN},
    ?assertEqual({ok, false}, verify(#{}, Req, Opts)).

block_inclusion_fixture() ->
    P = read_eterm("block_inclusion.eterm"),
    Base = #{
        <<"raw">>    => maps:get(raw, P),
        <<"header">> => maps:get(header, P)
    },
    Req = #{
        <<"type">>                 => <<"mmr-block-inclusion">>,
        <<"txid">>                 => maps:get(txid, P),
        <<"branch">>               => maps:get(branch, P),
        <<"position">>             => maps:get(position, P),
        <<"height">>               => maps:get(height, P),
        <<"mmr-proof">>            => maps:get(siblings, P),
        <<"mmr-proof-peaks">>      => maps:get(other_peaks, P),
        <<"mmr-proof-peak-index">> => maps:get(peak_index, P)
    },
    Opts = #{
        <<"lbry-header-root">>       => maps:get(root, P),
        <<"lbry-header-snapshot-n">> => maps:get(n, P)
    },
    {Base, Req, Opts}.

verify_block_inclusion_test() ->
    {Base, Req, Opts} = block_inclusion_fixture(),
    ?assertEqual({ok, true}, verify(Base, Req, Opts)).

verify_block_inclusion_tampered_test() ->
    {Base, Req, Opts} = block_inclusion_fixture(),
    ?assertEqual(
        {ok, false},
        verify(Base, Req#{<<"txid">> => binary:copy(<<$0>>, 64)}, Opts)).

verify_block_inclusion_ignores_request_payload_test() ->
    {Base, Req, Opts} = block_inclusion_fixture(),
    ReqWithPayload = Req#{
        <<"raw">>    => maps:get(<<"raw">>, Base),
        <<"header">> => maps:get(<<"header">>, Base)
    },
    ?assertEqual({error, missing_fields}, verify(#{}, ReqWithPayload, Opts)).

unknown_type_test() ->
    ?assertEqual(
        {error, unknown_commitment_type},
        verify(#{}, #{<<"type">> => <<"tee-tail">>}, #{})).

-endif.
