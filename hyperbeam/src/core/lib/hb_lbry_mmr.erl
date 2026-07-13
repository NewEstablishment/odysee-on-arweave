%%% @doc LBRY header-commitment primitives: SHA256d hashing, the Merkle Mountain
%%% Range (MMR) over block hashes, and the Electrum transaction-merkle fold.
%%%
%%% The MMR is the 32-byte commitment from which Odysee header trust bootstraps
%%% (see `aidocs/003_header_commitment_design.md'). Leaves are block hashes
%%% (`sha256d(header)'), interior nodes are `sha256d(L || R)', peaks are bagged
%%% right-to-left, and a chunk is the height-10 perfect subtree over exactly
%%% 1024 block hashes. These constructions are byte-validated against mainnet.
%%%
%%% This module is a pure library: every function is deterministic over its
%%% arguments and performs no I/O. Hashes are handled as raw 32-byte binaries
%%% internally; callers convert display hex at the edge.
-module(hb_lbry_mmr).
-export([sha256/1, sha256d/1]).
-export([mmr_peaks/1, bag_peaks/1, insert_at/3, fold_to_peak/4]).
-export([mmr_append/2, mmr_root/1, chunk_subtree_root/1]).
-export([verify_membership/5, verify_consistency/5]).
-export([merkle_fold/3]).
-include_lib("eunit/include/eunit.hrl").

-define(CHUNK_HEADERS, 1024).

%%% --------------------------------------------------------------------------
%%% Hashing primitives
%%% --------------------------------------------------------------------------

sha256(Bin) -> crypto:hash(sha256, Bin).

sha256d(Bin) -> sha256(sha256(Bin)).

%%% --------------------------------------------------------------------------
%%% MMR shape helpers
%%% --------------------------------------------------------------------------

%% @doc Peak sizes of the size-`N' MMR, largest-first. Each set bit of `N' is a
%% perfect subtree; e.g. `mmr_peaks(7) = [4, 2, 1]'.
mmr_peaks(N) ->
    mmr_peaks(N, bit_length(N) - 1, []).

mmr_peaks(_N, Bit, Acc) when Bit < 0 -> lists:reverse(Acc);
mmr_peaks(N, Bit, Acc) ->
    Size = 1 bsl Bit,
    case N band Size of
        0 -> mmr_peaks(N, Bit - 1, Acc);
        _ -> mmr_peaks(N, Bit - 1, [Size | Acc])
    end.

bit_length(0) -> 0;
bit_length(N) -> bit_length(N, 0).

bit_length(0, Acc) -> Acc;
bit_length(N, Acc) -> bit_length(N bsr 1, Acc + 1).

%% @doc Bag peaks right-to-left: `root = peak_k'; for `i = k-1..0',
%% `root = sha256d(peak_i || root)'.
bag_peaks([]) -> <<0:256>>;
bag_peaks([Single]) -> Single;
bag_peaks(Peaks) ->
    [Last | RevRest] = lists:reverse(Peaks),
    lists:foldl(fun(P, Acc) -> sha256d(<<P/binary, Acc/binary>>) end, Last, RevRest).

%% @doc Insert `Elem' at 0-based `Index' of `List'. Returns `false' for an
%% improper list or an index outside `0..length(List)'.
insert_at(List, Index, Elem) when is_integer(Index), Index >= 0 ->
    case proper_list(List) of
        true -> insert_at(List, Index, Elem, []);
        false -> false
    end;
insert_at(_List, _Index, _Elem) ->
    false.

proper_list([]) ->
    true;
proper_list([_Head | Rest]) ->
    proper_list(Rest);
proper_list(_Term) ->
    false.

insert_at(Rest, 0, Elem, RevBefore) ->
    lists:reverse(RevBefore, [Elem | Rest]);
insert_at([Head | Rest], Index, Elem, RevBefore) when Index > 0 ->
    insert_at(Rest, Index - 1, Elem, [Head | RevBefore]);
insert_at([], _Index, _Elem, _RevBefore) ->
    false.

%%% --------------------------------------------------------------------------
%%% MMR construction (append / root)
%%% --------------------------------------------------------------------------

%% @doc Append one leaf hash to a peaks list of `{Height, Hash}' (strictly
%% decreasing height), merging equal-height peaks. Matches the Python reference
%% (`aidocs/007_roll_forward_headers.py').
mmr_append(Peaks, LeafHash) ->
    mmr_append(lists:reverse(Peaks), LeafHash, 0).

mmr_append([{H, Peak} | RevRest], Node, H) ->
    mmr_append(RevRest, sha256d(<<Peak/binary, Node/binary>>), H + 1);
mmr_append(RevPeaks, Node, H) ->
    lists:reverse([{H, Node} | RevPeaks]).

%% @doc MMR root over an ordered list of leaf hashes.
mmr_root(LeafHashes) ->
    Peaks = lists:foldl(fun(L, Acc) -> mmr_append(Acc, L) end, [], LeafHashes),
    bag_peaks([P || {_H, P} <- Peaks]).

%% @doc Height-10 perfect binary tree over exactly 1024 block hashes (chunk root).
chunk_subtree_root(Hashes) when length(Hashes) =:= ?CHUNK_HEADERS ->
    perfect_subtree_root(Hashes).

perfect_subtree_root([H]) -> H;
perfect_subtree_root(Leaves) ->
    Half = length(Leaves) div 2,
    {Left, Right} = lists:split(Half, Leaves),
    sha256d(<<(perfect_subtree_root(Left))/binary,
              (perfect_subtree_root(Right))/binary>>).

%%% --------------------------------------------------------------------------
%%% Membership proof
%%% --------------------------------------------------------------------------

%% @doc Fold proof siblings from the leaf at 0-based `Height' up to its peak in
%% the size-`N' MMR. The canonical peak layout determines both the local index
%% and the exact sibling depth. Invalid inputs return `false'.
fold_to_peak(LeafHash, Height, N, Siblings)
        when is_binary(LeafHash), byte_size(LeafHash) =:= 32,
             is_integer(Height), Height >= 0,
             is_integer(N), N > 0, Height < N,
             is_list(Siblings) ->
    case membership_layout(N, Height) of
        {_PeakIndex, PeakStart, SiblingDepth, _OtherPeakCount}
                when length(Siblings) =:= SiblingDepth ->
            case valid_hashes(Siblings) of
                true -> fold_siblings(LeafHash, Height - PeakStart, Siblings);
                false -> false
            end;
        _ ->
            false
    end;
fold_to_peak(_LeafHash, _Height, _N, _Siblings) ->
    false.

fold_siblings(Hash, _LocalIndex, []) -> Hash;
fold_siblings(Hash, LocalIndex, [Sibling | Rest]) ->
    NewHash =
        case LocalIndex band 1 of
            0 -> sha256d(<<Hash/binary, Sibling/binary>>);
            1 -> sha256d(<<Sibling/binary, Hash/binary>>)
        end,
    fold_siblings(NewHash, LocalIndex bsr 1, Rest).

%% @doc Verify that `LeafHash' sits at 0-based `Height' of the size-`N' MMR
%% committed to by `Root'. The proof tuple remains
%% `{Siblings, OtherPeaks, PeakIndex}', but every part must exactly match the
%% canonical peak layout derived from `N' and `Height'. All hashes are raw
%% 32-byte binaries. Malformed proofs return `false'.
verify_membership(LeafHash, Height, {Siblings, OtherPeaks, PeakIndex}, N, Root)
        when is_binary(LeafHash), byte_size(LeafHash) =:= 32,
             is_integer(Height), Height >= 0,
             is_integer(N), N > 0, Height < N,
             is_list(Siblings), is_list(OtherPeaks),
             is_integer(PeakIndex), PeakIndex >= 0,
             is_binary(Root), byte_size(Root) =:= 32 ->
    case membership_layout(N, Height) of
        {PeakIndex, PeakStart, SiblingDepth, OtherPeakCount}
                when length(Siblings) =:= SiblingDepth,
                     length(OtherPeaks) =:= OtherPeakCount ->
            case valid_hashes(Siblings) andalso valid_hashes(OtherPeaks) of
                false ->
                    false;
                true ->
                    ComputedPeak =
                        fold_siblings(LeafHash, Height - PeakStart, Siblings),
                    case insert_at(OtherPeaks, PeakIndex, ComputedPeak) of
                        false -> false;
                        AllPeaks -> bag_peaks(AllPeaks) =:= Root
                    end
            end;
        _ ->
            false
    end;
verify_membership(_LeafHash, _Height, _Proof, _N, _Root) ->
    false.

membership_layout(N, Height) ->
    PeakSizes = mmr_peaks(N),
    membership_layout(Height, PeakSizes, 0, 0, length(PeakSizes) - 1).

membership_layout(Height, [PeakSize | Rest], PeakStart, PeakIndex, OtherPeakCount) ->
    case Height < PeakStart + PeakSize of
        true ->
            {PeakIndex, PeakStart, bit_length(PeakSize) - 1, OtherPeakCount};
        false ->
            membership_layout(
                Height,
                Rest,
                PeakStart + PeakSize,
                PeakIndex + 1,
                OtherPeakCount
            )
    end;
membership_layout(_Height, [], _PeakStart, _PeakIndex, _OtherPeakCount) ->
    false.

%%% --------------------------------------------------------------------------
%%% Consistency proof (roll-forward)
%%% --------------------------------------------------------------------------

%% @doc Verify an MMR roll-forward from `FromRoot' to `ToRoot'. `OldPeaks' must
%% be the exact canonical `{Height, Hash}' frontier for `FromN'; `DeltaLeaves'
%% are the independently validated new leaf hashes appended. `FromN = 0' is
%% accepted only with the empty frontier and the canonical zero root. Malformed
%% proofs return `false'.
verify_consistency(FromRoot, FromN, OldPeaks, DeltaLeaves, ToRoot)
        when is_binary(FromRoot), byte_size(FromRoot) =:= 32,
             is_integer(FromN), FromN >= 0,
             is_list(OldPeaks), is_list(DeltaLeaves),
             is_binary(ToRoot), byte_size(ToRoot) =:= 32 ->
    case canonical_frontier(FromN, OldPeaks)
            andalso valid_hashes(DeltaLeaves)
            andalso frontier_root(OldPeaks) =:= FromRoot of
        false ->
            false;
        true ->
            NewPeaks =
                lists:foldl(
                    fun(Leaf, Acc) -> mmr_append(Acc, Leaf) end,
                    OldPeaks,
                    DeltaLeaves
                ),
            frontier_root(NewPeaks) =:= ToRoot
    end;
verify_consistency(_FromRoot, _FromN, _OldPeaks, _DeltaLeaves, _ToRoot) ->
    false.

canonical_frontier(N, Peaks) ->
    Heights = [bit_length(Size) - 1 || Size <- mmr_peaks(N)],
    canonical_frontier_heights(Heights, Peaks).

canonical_frontier_heights([], []) ->
    true;
canonical_frontier_heights(
    [Height | RestHeights],
    [{Height, Hash} | RestPeaks]
) when is_binary(Hash), byte_size(Hash) =:= 32 ->
    canonical_frontier_heights(RestHeights, RestPeaks);
canonical_frontier_heights(_Heights, _Peaks) ->
    false.

frontier_root(Peaks) ->
    bag_peaks([Hash || {_Height, Hash} <- Peaks]).

valid_hashes([]) ->
    true;
valid_hashes([Hash | Rest]) when is_binary(Hash), byte_size(Hash) =:= 32 ->
    valid_hashes(Rest);
valid_hashes(_Hashes) ->
    false.

%%% --------------------------------------------------------------------------
%%% Transaction merkle fold (Electrum)
%%% --------------------------------------------------------------------------

%% @doc Fold `TxId' (raw 32-byte internal order) up a merkle `Branch' of raw
%% 32-byte siblings, with `Pos' selecting left/right at each level. Returns the
%% merkle root (raw 32 bytes).
merkle_fold(TxId, [], _Pos) ->
    TxId;
merkle_fold(TxId, [Sibling | Rest], Pos) ->
    Working =
        case Pos band 1 of
            1 -> sha256d(<<Sibling/binary, TxId/binary>>);
            0 -> sha256d(<<TxId/binary, Sibling/binary>>)
        end,
    merkle_fold(Working, Rest, Pos bsr 1).

%%% --------------------------------------------------------------------------
%%% Tests
%%% --------------------------------------------------------------------------

sha256d_test() ->
    Expected =
        binary:decode_hex(
            <<"9595c9df90075148eb06860365df33584b75bff782a510c6cd4883a419833d50">>),
    ?assertEqual(Expected, sha256d(<<"hello">>)).

mmr_peaks_test() ->
    ?assertEqual([4, 2, 1], mmr_peaks(7)),
    ?assertEqual([8], mmr_peaks(8)),
    ?assertEqual([1], mmr_peaks(1)).

mmr_root_single_peak_test() ->
    L = [sha256d(<<"leaf", (integer_to_binary(I))/binary>>) || I <- lists:seq(0, 3)],
    [L0, L1, L2, L3] = L,
    N01 = sha256d(<<L0/binary, L1/binary>>),
    N23 = sha256d(<<L2/binary, L3/binary>>),
    Expected = sha256d(<<N01/binary, N23/binary>>),
    ?assertEqual(Expected, mmr_root(L)).

mmr_append_matches_root_test() ->
    L = [sha256d(<<"x", (integer_to_binary(I))/binary>>) || I <- lists:seq(0, 6)],
    Peaks = lists:foldl(fun(X, Acc) -> mmr_append(Acc, X) end, [], L),
    Heights = [H || {H, _} <- Peaks],
    ?assertEqual([2, 1, 0], Heights),
    ?assertEqual(bag_peaks([P || {_, P} <- Peaks]), mmr_root(L)).

verify_membership_test() ->
    L = [sha256d(<<"blk", (integer_to_binary(I))/binary>>) || I <- lists:seq(0, 3)],
    [L0, L1, L2, L3] = L,
    N01 = sha256d(<<L0/binary, L1/binary>>),
    N23 = sha256d(<<L2/binary, L3/binary>>),
    Root = sha256d(<<N01/binary, N23/binary>>),
    ?assert(verify_membership(L0, 0, {[L1, N23], [], 0}, 4, Root)),
    ?assertNot(verify_membership(sha256d(<<"wrong">>), 0, {[L1, N23], [], 0}, 4, Root)).

membership_root_as_leaf_regression_test() ->
    Leaves = test_leaves(<<"root-as-leaf">>, 4),
    Root = mmr_root(Leaves),
    ?assertNot(verify_membership(Root, 0, {[], [], 0}, 4, Root)),
    [Single] = test_leaves(<<"single">>, 1),
    ?assert(verify_membership(Single, 0, {[], [], 0}, 1, Single)).

membership_requires_canonical_proof_shape_test() ->
    Leaves = test_leaves(<<"shape">>, 7),
    Leaf = lists:nth(2, Leaves),
    Root = mmr_root(Leaves),
    {Siblings, [Other0, Other1] = OtherPeaks, PeakIndex} =
        make_membership_proof(Leaves, 1),
    [Sibling0, Sibling1] = Siblings,
    WrongHash = sha256d(<<"wrong-proof-piece">>),
    ExtraHash = sha256d(<<"extra">>),
    ?assert(verify_membership(Leaf, 1, {Siblings, OtherPeaks, PeakIndex}, 7, Root)),
    ?assertNot(
        verify_membership(Leaf, 1, {[WrongHash, Sibling1], OtherPeaks, PeakIndex}, 7, Root)
    ),
    ?assertNot(
        verify_membership(Leaf, 1, {Siblings, [WrongHash, Other1], PeakIndex}, 7, Root)
    ),
    ?assertNot(verify_membership(Leaf, 1, {[Sibling0], OtherPeaks, PeakIndex}, 7, Root)),
    ?assertNot(
        verify_membership(
            Leaf,
            1,
            {[Sibling0, Sibling1, ExtraHash], OtherPeaks, PeakIndex},
            7,
            Root
        )),
    ?assertNot(verify_membership(Leaf, 1, {Siblings, [Other0], PeakIndex}, 7, Root)),
    ?assertNot(
        verify_membership(
            Leaf,
            1,
            {Siblings, [Other0, Other1, ExtraHash], PeakIndex},
            7,
            Root
        )),
    ?assertNot(verify_membership(Leaf, 1, {Siblings, OtherPeaks, PeakIndex + 1}, 7, Root)).

membership_rejects_invalid_inputs_test() ->
    Leaves = test_leaves(<<"invalid">>, 7),
    Leaf = hd(Leaves),
    Root = mmr_root(Leaves),
    {Siblings, OtherPeaks, PeakIndex} = Proof = make_membership_proof(Leaves, 0),
    ?assertNot(verify_membership(Leaf, -1, Proof, 7, Root)),
    ?assertNot(verify_membership(Leaf, 7, Proof, 7, Root)),
    ?assertNot(verify_membership(Leaf, 0.0, Proof, 7, Root)),
    ?assertNot(verify_membership(Leaf, 0, Proof, 0, Root)),
    ?assertNot(verify_membership(Leaf, 0, Proof, -1, Root)),
    ?assertNot(verify_membership(Leaf, 0, Proof, 7.0, Root)),
    ?assertNot(verify_membership(<<0:248>>, 0, Proof, 7, Root)),
    ?assertNot(verify_membership(not_a_hash, 0, Proof, 7, Root)),
    ?assertNot(verify_membership(Leaf, 0, Proof, 7, <<0:248>>)),
    ?assertNot(verify_membership(Leaf, 0, Proof, 7, not_a_hash)),
    ?assertNot(verify_membership(Leaf, 0, not_a_proof, 7, Root)),
    ?assertNot(verify_membership(Leaf, 0, {Siblings, OtherPeaks}, 7, Root)),
    ?assertNot(verify_membership(Leaf, 0, {Siblings, OtherPeaks, -1}, 7, Root)),
    ?assertNot(verify_membership(Leaf, 0, {Siblings, OtherPeaks, 0.0}, 7, Root)),
    ?assertNot(
        verify_membership(Leaf, 0, {[<<0:248>> | tl(Siblings)], OtherPeaks, PeakIndex}, 7, Root)
    ),
    ?assertNot(
        verify_membership(Leaf, 0, {Siblings, [<<0:248>> | tl(OtherPeaks)], PeakIndex}, 7, Root)
    ),
    ?assertNot(
        verify_membership(
            Leaf,
            0,
            {[hd(Siblings) | improper], OtherPeaks, PeakIndex},
            7,
            Root
        )
    ),
    ?assertNot(
        verify_membership(
            Leaf,
            0,
            {Siblings, [hd(OtherPeaks) | improper], PeakIndex},
            7,
            Root
        )
    ),
    ?assertEqual(false, fold_to_peak(Leaf, 7, 7, Siblings)),
    ?assertEqual(false, fold_to_peak(Leaf, 0, 7, [<<0:248>> | tl(Siblings)])),
    ?assertEqual([a, inserted, b], insert_at([a, b], 1, inserted)),
    ?assertEqual(false, insert_at([a], -1, inserted)),
    ?assertEqual(false, insert_at([a], 2, inserted)),
    ?assertEqual(false, insert_at([a | improper], 1, inserted)),
    ?assertEqual(false, insert_at([a], not_an_index, inserted)).

generated_small_membership_proofs_test() ->
    lists:foreach(
        fun(N) ->
            Leaves = test_leaves(<<"generated-membership">>, N),
            Root = mmr_root(Leaves),
            lists:foreach(
                fun(Index) ->
                    Proof = make_membership_proof(Leaves, Index),
                    Leaf = lists:nth(Index + 1, Leaves),
                    ?assert(verify_membership(Leaf, Index, Proof, N, Root))
                end,
                lists:seq(0, N - 1)
            )
        end,
        lists:seq(1, 32)
    ).

verify_consistency_test() ->
    All = test_leaves(<<"consistency">>, 7),
    {Old, Delta} = lists:split(4, All),
    OldPeaks = peaks_for_leaves(Old),
    FromRoot = frontier_root(OldPeaks),
    ToRoot = mmr_root(All),
    ?assert(verify_consistency(FromRoot, length(Old), OldPeaks, Delta, ToRoot)),
    ?assertNot(
        verify_consistency(FromRoot, length(Old), OldPeaks, Delta, sha256d(<<"bad">>))
    ),
    ?assertNot(
        verify_consistency(
            sha256d(<<"badfrom">>),
            length(Old),
            OldPeaks,
            Delta,
            ToRoot
        )
    ).

consistency_rejects_forged_single_peak_test() ->
    All = test_leaves(<<"forged">>, 7),
    {Old, Delta} = lists:split(4, All),
    OldPeaks = peaks_for_leaves(Old),
    FromRoot = frontier_root(OldPeaks),
    ForgedOldPeaks = [{0, FromRoot}],
    ForgedNewPeaks =
        lists:foldl(fun(Leaf, Acc) -> mmr_append(Acc, Leaf) end, ForgedOldPeaks, Delta),
    ForgedToRoot = frontier_root(ForgedNewPeaks),
    ?assertNot(verify_consistency(FromRoot, 4, ForgedOldPeaks, Delta, ForgedToRoot)).

consistency_requires_canonical_frontier_test() ->
    Old = test_leaves(<<"frontier">>, 7),
    Delta = test_leaves(<<"frontier-delta">>, 2),
    OldPeaks = peaks_for_leaves(Old),
    FromRoot = frontier_root(OldPeaks),
    ToRoot = mmr_root(Old ++ Delta),
    [Peak0, Peak1, Peak2] = OldPeaks,
    {Height0, Hash0} = Peak0,
    ?assert(verify_consistency(FromRoot, 7, OldPeaks, Delta, ToRoot)),
    ?assertNot(verify_consistency(FromRoot, 7, [Peak1, Peak0, Peak2], Delta, ToRoot)),
    ?assertNot(verify_consistency(FromRoot, 7, [Peak0, Peak1], Delta, ToRoot)),
    ?assertNot(
        verify_consistency(
            FromRoot,
            7,
            OldPeaks ++ [{0, sha256d(<<"extra-peak">>)}],
            Delta,
            ToRoot
        )
    ),
    ?assertNot(
        verify_consistency(FromRoot, 7, [{Height0 - 1, Hash0}, Peak1, Peak2], Delta, ToRoot)
    ),
    ?assertNot(verify_consistency(FromRoot, 7, [malformed, Peak1, Peak2], Delta, ToRoot)),
    ?assertNot(
        verify_consistency(FromRoot, 7, [{Height0, <<0:248>>}, Peak1, Peak2], Delta, ToRoot)
    ),
    ?assertNot(verify_consistency(FromRoot, 7, [Peak0, Peak1 | improper], Delta, ToRoot)).

consistency_empty_delta_and_empty_mmr_test() ->
    Old = test_leaves(<<"empty-delta">>, 7),
    OldPeaks = peaks_for_leaves(Old),
    Root = mmr_root(Old),
    ZeroRoot = <<0:256>>,
    Leaf = sha256d(<<"first-leaf">>),
    ?assert(verify_consistency(Root, 7, OldPeaks, [], Root)),
    ?assertNot(verify_consistency(Root, 7, OldPeaks, [], sha256d(<<"different">>))),
    ?assert(verify_consistency(ZeroRoot, 0, [], [], ZeroRoot)),
    ?assert(verify_consistency(ZeroRoot, 0, [], [Leaf], Leaf)),
    ?assertNot(verify_consistency(sha256d(<<"not-empty">>), 0, [], [], ZeroRoot)),
    ?assertNot(verify_consistency(ZeroRoot, 0, [{0, ZeroRoot}], [], ZeroRoot)).

consistency_rejects_malformed_inputs_test() ->
    Old = test_leaves(<<"malformed-consistency">>, 3),
    OldPeaks = peaks_for_leaves(Old),
    Root = mmr_root(Old),
    Delta = [sha256d(<<"delta">>)],
    ToRoot = mmr_root(Old ++ Delta),
    ?assertNot(verify_consistency(<<0:248>>, 3, OldPeaks, Delta, ToRoot)),
    ?assertNot(verify_consistency(not_a_hash, 3, OldPeaks, Delta, ToRoot)),
    ?assertNot(verify_consistency(Root, -1, OldPeaks, Delta, ToRoot)),
    ?assertNot(verify_consistency(Root, 3.0, OldPeaks, Delta, ToRoot)),
    ?assertNot(verify_consistency(Root, 3, not_a_list, Delta, ToRoot)),
    ?assertNot(verify_consistency(Root, 3, OldPeaks, not_a_list, ToRoot)),
    ?assertNot(verify_consistency(Root, 3, OldPeaks, [<<0:248>>], ToRoot)),
    ?assertNot(verify_consistency(Root, 3, OldPeaks, [Delta | improper], ToRoot)),
    ?assertNot(verify_consistency(Root, 3, OldPeaks, Delta, <<0:248>>)),
    ?assertNot(verify_consistency(Root, 3, OldPeaks, Delta, not_a_hash)).

generated_small_roll_forward_test() ->
    All = test_leaves(<<"generated-consistency">>, 16),
    lists:foreach(
        fun(FromN) ->
            {Old, AvailableDelta} = lists:split(FromN, All),
            OldPeaks = peaks_for_leaves(Old),
            FromRoot = mmr_root(Old),
            lists:foreach(
                fun(DeltaCount) ->
                    Delta = lists:sublist(AvailableDelta, DeltaCount),
                    ToRoot = mmr_root(Old ++ Delta),
                    ?assert(
                        verify_consistency(
                            FromRoot,
                            FromN,
                            OldPeaks,
                            Delta,
                            ToRoot
                        )
                    )
                end,
                lists:seq(0, length(AvailableDelta))
            )
        end,
        lists:seq(0, length(All))
    ).

test_leaves(Prefix, Count) ->
    [sha256d(<<Prefix/binary, I:32/unsigned-big>>) || I <- lists:seq(0, Count - 1)].

peaks_for_leaves(Leaves) ->
    lists:foldl(fun(Leaf, Acc) -> mmr_append(Acc, Leaf) end, [], Leaves).

make_membership_proof(Leaves, Index) ->
    PeakGroups = split_peak_groups(Leaves, mmr_peaks(length(Leaves))),
    {PeakIndex, LocalIndex, PeakLeaves} = locate_peak_group(Index, PeakGroups, 0),
    PeakHashes = [perfect_subtree_root(Group) || Group <- PeakGroups],
    OtherPeaks =
        [
            Hash
         || {Index0, Hash} <- lists:zip(lists:seq(0, length(PeakHashes) - 1), PeakHashes),
            Index0 =/= PeakIndex
        ],
    {perfect_siblings(PeakLeaves, LocalIndex), OtherPeaks, PeakIndex}.

split_peak_groups([], []) ->
    [];
split_peak_groups(Leaves, [PeakSize | RestSizes]) ->
    {PeakLeaves, RestLeaves} = lists:split(PeakSize, Leaves),
    [PeakLeaves | split_peak_groups(RestLeaves, RestSizes)].

locate_peak_group(Index, [PeakLeaves | Rest], PeakIndex) ->
    PeakSize = length(PeakLeaves),
    case Index < PeakSize of
        true -> {PeakIndex, Index, PeakLeaves};
        false -> locate_peak_group(Index - PeakSize, Rest, PeakIndex + 1)
    end.

perfect_siblings([_Leaf], 0) ->
    [];
perfect_siblings(Leaves, LocalIndex) ->
    Half = length(Leaves) div 2,
    {Left, Right} = lists:split(Half, Leaves),
    case LocalIndex < Half of
        true -> perfect_siblings(Left, LocalIndex) ++ [perfect_subtree_root(Right)];
        false ->
            perfect_siblings(Right, LocalIndex - Half) ++ [perfect_subtree_root(Left)]
    end.

merkle_fold_test() ->
    Tx = [sha256d(<<"tx", (integer_to_binary(I))/binary>>) || I <- lists:seq(0, 3)],
    [_, _, T2, T3] = Tx,
    [T0, T1, _, _] = Tx,
    N0 = sha256d(<<T0/binary, T1/binary>>),
    N1 = sha256d(<<T2/binary, T3/binary>>),
    Root = sha256d(<<N0/binary, N1/binary>>),
    ?assertEqual(Root, merkle_fold(T2, [T3, N0], 2)).

%%% Fixture-backed tests (network-free) against mainnet-validated vectors.

-define(FIXTURE, "test/fixtures/lbry/").

read_fixture(Name) ->
    {ok, Bin} = file:read_file(?FIXTURE ++ Name),
    Bin.

read_eterm(Name) ->
    {ok, [Term]} = file:consult(?FIXTURE ++ Name),
    Term.

hx(H) -> binary:decode_hex(H).

%% Height-10 subtree root of header chunk 0 (heights 0..1023), mainnet-validated.
chunk_subtree_root_fixture_test() ->
    Chunk0 = read_fixture("chunk0.bin"),
    Hashes = [sha256d(binary:part(Chunk0, I * 112, 112)) || I <- lists:seq(0, 1023)],
    Expected =
        hx(<<"7621d56d4aec31d0c874008dec0e12b04d0b863546ccbf21c47e872f43a519e4">>),
    ?assertEqual(Expected, chunk_subtree_root(Hashes)).

%% Real mainnet MMR membership proof (height 2058011, N=2058045).
membership_real_fixture_test() ->
    P = read_eterm("mmr_proof_2058011.eterm"),
    Proof =
        {
            [hx(S) || S <- maps:get(siblings, P)],
            [hx(O) || O <- maps:get(other_peaks, P)],
            maps:get(peak_index, P)
        },
    ?assert(
        verify_membership(
            hx(maps:get(leaf_hash, P)),
            maps:get(height, P),
            Proof,
            maps:get(n, P),
            hx(maps:get(root, P))
        )).

membership_real_fixture_tampered_test() ->
    P = read_eterm("mmr_proof_2058011.eterm"),
    [First | Rest] = maps:get(siblings, P),
    <<Byte, Tail/binary>> = hx(First),
    Proof =
        {
            [<<(Byte bxor 1), Tail/binary>> | [hx(S) || S <- Rest]],
            [hx(O) || O <- maps:get(other_peaks, P)],
            maps:get(peak_index, P)
        },
    ?assertNot(
        verify_membership(
            hx(maps:get(leaf_hash, P)),
            maps:get(height, P),
            Proof,
            maps:get(n, P),
            hx(maps:get(root, P)))).
