%%% @doc Packaged public-API regressions for `lbry-header@1.0'. These tests use
%%% `hb_ao:raw/5' so they exercise the generated preloaded device rather than
%%% calling the source module directly.
-module(hb_lbry_header_test).
-include_lib("eunit/include/eunit.hrl").

-define(FIXTURE, "test/fixtures/lbry/").

membership_fixture() ->
    {ok, [Proof]} = file:consult(?FIXTURE ++ "mmr_proof_2058011.eterm"),
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
    {Req, Opts}.

verify(Base, Req, Opts) ->
    hb_ao:raw(<<"lbry-header@1.0">>, <<"verify">>, Base, Req, Opts).

packaged_membership_fixture_verifies_test() ->
    {Req, Opts} = membership_fixture(),
    ?assertEqual({ok, true}, verify(#{}, Req, Opts)).

packaged_membership_rejects_root_as_leaf_test() ->
    {Req, Opts} = membership_fixture(),
    Forged = Req#{
        <<"block-hash">> => maps:get(<<"lbry-header-root">>, Opts),
        <<"mmr-proof">> => [],
        <<"mmr-proof-peaks">> => [],
        <<"mmr-proof-peak-index">> => 0
    },
    ?assertEqual({ok, false}, verify(#{}, Forged, Opts)).

packaged_membership_reads_request_only_test() ->
    {Req, Opts} = membership_fixture(),
    ?assertEqual(
        {error, missing_fields},
        verify(Req, #{ <<"type">> => <<"mmr-membership">> }, Opts)
    ).

packaged_membership_rejects_malformed_input_test() ->
    {Req, Opts} = membership_fixture(),
    ?assertEqual(
        {error, invalid_hash_list},
        verify(#{}, Req#{ <<"mmr-proof">> => not_a_list }, Opts)
    ).

packaged_consistency_rejects_forged_frontier_test() ->
    Leaves = [hb_lbry_mmr:sha256d(<<"header", I:32/unsigned-big>>)
        || I <- lists:seq(0, 6)],
    {Old, Delta} = lists:split(4, Leaves),
    OldPeaks = lists:foldl(
        fun(Leaf, Peaks) -> hb_lbry_mmr:mmr_append(Peaks, Leaf) end,
        [],
        Old
    ),
    FromRoot = hb_lbry_mmr:bag_peaks([Hash || {_Height, Hash} <- OldPeaks]),
    ForgedPeaks = [{0, FromRoot}],
    ForgedNewPeaks = lists:foldl(
        fun(Leaf, Peaks) -> hb_lbry_mmr:mmr_append(Peaks, Leaf) end,
        ForgedPeaks,
        Delta
    ),
    ForgedRoot = hb_lbry_mmr:bag_peaks(
        [Hash || {_Height, Hash} <- ForgedNewPeaks]
    ),
    Req = #{
        <<"type">> => <<"mmr-consistency">>,
        <<"old-peaks">> => ForgedPeaks,
        <<"delta-leaves">> => Delta,
        <<"to-root">> => ForgedRoot
    },
    Opts = #{
        <<"lbry-header-root">> => FromRoot,
        <<"lbry-header-snapshot-n">> => length(Old)
    },
    ?assertEqual({ok, false}, verify(#{}, Req, Opts)),
    ?assertEqual(
        {error, missing_fields},
        verify(#{}, Req, maps:remove(<<"lbry-header-snapshot-n">>, Opts))
    ).
