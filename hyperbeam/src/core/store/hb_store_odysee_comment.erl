%%% @doc Comment store: loads a comment message by its immutable comment id
%%% (the 32-byte content hash assigned on creation), fetching live from the
%%% `odysee-comment@1.0' device on a miss. One of the per-backend stores split
%%% out of the omnibus odysee store: its contract is strictly immutable ID ->
%%% comment message, with name/listing computations left to the devices.
%%%
%%% Accepted key shapes: `odysee/comment/<id>', `odysee/comment-id/<id>' and
%%% a bare 64-hex comment id. Bare ids are only unambiguous when routed here
%%% by the odysee dispatcher store; a standalone mount should use the
%%% prefixed forms (bare 64-hex also matches lbry transaction ids).
-module(hb_store_odysee_comment).
-export([scope/0, scope/1, resolve/3, read/3]).
-include("include/hb.hrl").
-include_lib("eunit/include/eunit.hrl").

scope() -> remote.
scope(_) -> scope().

resolve(_StoreOpts, #{ <<"resolve">> := Key }, _NodeOpts) ->
    case normalize_comment_key(Key) of
        {ok, CommentID} -> {ok, CommentID};
        error -> {error, not_found}
    end.

read(StoreOpts, #{ <<"read">> := Key }, NodeOpts) ->
    case normalize_comment_key(Key) of
        {ok, CommentID} ->
            case fixture(StoreOpts, CommentID, NodeOpts) of
                {ok, Msg} -> {ok, Msg};
                not_found -> read_live(StoreOpts, CommentID, NodeOpts)
            end;
        error ->
            {error, not_found}
    end;
read(StoreOpts, Key, NodeOpts) when is_binary(Key) ->
    read(StoreOpts, #{ <<"read">> => Key }, NodeOpts).

read_live(StoreOpts, CommentID, NodeOpts) ->
    hb_ao:raw(
        <<"odysee-comment@1.0">>,
        <<"by-id">>,
        #{},
        #{ <<"comment-id">> => CommentID },
        store_node_opts(StoreOpts, NodeOpts)
    ).

fixture(StoreOpts, CommentID, Opts) ->
    Fixtures = hb_maps:get(<<"fixtures">>, StoreOpts, #{}, Opts),
    Keys = [
        CommentID,
        <<"odysee/comment/", CommentID/binary>>,
        <<"odysee/comment-id/", CommentID/binary>>
    ],
    first_fixture(Keys, Fixtures, Opts).

first_fixture([], _Fixtures, _Opts) ->
    not_found;
first_fixture([Key | Rest], Fixtures, Opts) ->
    case hb_maps:get(Key, Fixtures, not_found, Opts) of
        not_found -> first_fixture(Rest, Fixtures, Opts);
        Msg -> {ok, Msg}
    end.

store_node_opts(StoreOpts, NodeOpts) ->
    hb_maps:merge(
        maps:without(
            [
                <<"fixtures">>,
                <<"store-module">>,
                <<"name">>,
                <<"scope">>
            ],
            StoreOpts
        ),
        NodeOpts
    ).

normalize_comment_key(<<"/", Rest/binary>>) ->
    normalize_comment_key(Rest);
normalize_comment_key(<<"odysee/comment-id/", CommentID/binary>>) ->
    normalize_comment_key(CommentID);
normalize_comment_key(<<"odysee/comment/", CommentID/binary>>) ->
    normalize_comment_key(CommentID);
normalize_comment_key(CommentID) when is_binary(CommentID) ->
    case valid_comment_id(CommentID) of
        true -> {ok, hb_util:to_lower(CommentID)};
        false -> error
    end;
normalize_comment_key(_) ->
    error.

valid_comment_id(CommentID) when is_binary(CommentID), byte_size(CommentID) == 64 ->
    try binary:decode_hex(CommentID) of
        Decoded -> byte_size(Decoded) == 32
    catch
        _:_ -> false
    end;
valid_comment_id(_) ->
    false.

fixture_read_serves_comment_message_test() ->
    CommentID = binary:encode_hex(crypto:hash(sha256, <<"comment">>), lowercase),
    Comment = #{
        <<"device">> => <<"odysee-comment@1.0">>,
        <<"comment-id">> => CommentID,
        <<"comment">> => #{ <<"comment">> => <<"hello">> }
    },
    Store = #{
        <<"store-module">> => ?MODULE,
        <<"fixtures">> => #{ <<"odysee/comment/", CommentID/binary>> => Comment }
    },
    ?assertEqual({ok, Comment}, read(Store, #{ <<"read">> => CommentID }, #{})),
    ?assertEqual(
        {ok, Comment},
        read(Store, #{ <<"read">> => <<"odysee/comment-id/", CommentID/binary>> }, #{})
    ).

resolve_rejects_non_comment_id_test() ->
    ?assertEqual(
        {error, not_found},
        resolve(#{}, #{ <<"resolve">> => <<"not-a-comment-id">> }, #{})
    ),
    ?assertEqual(
        {error, not_found},
        resolve(#{}, #{ <<"resolve">> => <<"odysee/comment/zz">> }, #{})
    ).
