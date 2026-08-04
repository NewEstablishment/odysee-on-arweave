%%% @doc Deterministic HyperBEAM addresses for Odysee content.
%%%
%%% HyperBEAM only short-circuits `GET /(id)' to a store read when the first
%%% path segment satisfies `?IS_ID', which accepts binaries of 43, 42 or 32
%%% bytes. No LBRY-native identifier does: a claim id is 40 hex characters, a
%%% txid 64, an sd-hash or blob hash 96, an outpoint 66 or more. Without a
%%% translation those objects are reachable only through a device call
%%% (`/~cache@1.0/read?read=odysee/...'), which is a path, not an id, so
%%% generic consumers -- `~query@1.0', a router such as weave.space, a peer
%%% replicating by id -- cannot address them.
%%%
%%% This module defines the translation: a pure function from a canonical
%%% store path to a 43-byte base64url id that is `?IS_ID'-shaped by
%%% construction (sha256 is 32 bytes, which base64url-encodes to 43
%%% characters). A store that materializes an object links the alias to the
%%% object's cache id, after which `GET /(alias)' resolves on any node
%%% holding the link, with no custom device involved.
%%%
%%% Two derivations, distinguished by a domain-separating prefix so an alias
%%% and a current-version pointer can never collide:
%%% <ul>
%%%   <li>`alias/1' addresses an immutable or locator-resolved object by its
%%%       canonical store path (`odysee/transaction/(txid)').</li>
%%%   <li>`current/1' addresses the live version of a mutable record by its
%%%       logical id (the record's root message id). Used by the record
%%%       contract, which re-links it whenever a revision or control is
%%%       accepted, so readers never have to fold a chain to find the head.</li>
%%% </ul>
%%%
%%% Both are computable offline from public inputs: a client can derive the
%%% address of an object it has never fetched, which is what makes the scheme
%%% usable by routers and peers rather than only by the node that built it.
%%%
%%% A link is a node assertion, not a commitment. A reader that does not
%%% trust the serving node verifies the message it gets back
%%% (`hb_message:verify/3' with `commitment-ids => all', since `lbry@1.0'
%%% commitments are content-addressed and carry no committer, so the default
%%% selection checks nothing).
-module(hb_odysee_address).
%% `alias/1' is an auto-imported BIF (process aliases) that this module has
%% no use for; the name is worth keeping for the address API.
-compile({no_auto_import, [alias/1]}).
-export([alias/1, current/1]).
-export([alias_prefix/0, current_prefix/0]).

-define(ALIAS_PREFIX, <<"odysee-alias:v1:">>).
-define(CURRENT_PREFIX, <<"odysee-current:v1:">>).

%% @doc The address of the object stored at a canonical `odysee/' store path.
alias(Path) when is_binary(Path) ->
    derive(?ALIAS_PREFIX, Path).

%% @doc The address of the live version of the record rooted at `LogicalID'.
current(LogicalID) when is_binary(LogicalID) ->
    derive(?CURRENT_PREFIX, LogicalID).

alias_prefix() -> ?ALIAS_PREFIX.

current_prefix() -> ?CURRENT_PREFIX.

derive(Prefix, Value) ->
    hb_util:encode(crypto:hash(sha256, <<Prefix/binary, Value/binary>>)).

%%% Tests

-ifdef(TEST).
-include_lib("eunit/include/eunit.hrl").

%% Every address must satisfy `?IS_ID' or the whole scheme is pointless:
%% HyperBEAM would not short-circuit `GET /(address)' to a store read.
addresses_are_id_shaped_test() ->
    Paths = [
        <<"odysee/transaction/", (binary:copy(<<"a">>, 64))/binary>>,
        <<"odysee/blob/", (binary:copy(<<"b">>, 96))/binary>>,
        <<"odysee/claim-id/", (binary:copy(<<"c">>, 40))/binary>>,
        <<"odysee/outpoint/", (binary:copy(<<"d">>, 64))/binary, ":0">>
    ],
    lists:foreach(
        fun(Path) ->
            Address = alias(Path),
            ?assertEqual(43, byte_size(Address)),
            ?assertEqual(Address, hb_util:encode(hb_util:decode(Address)))
        end,
        Paths
    ).

derivation_is_deterministic_test() ->
    Path = <<"odysee/descriptor/", (binary:copy(<<"e">>, 96))/binary>>,
    ?assertEqual(alias(Path), alias(Path)),
    ?assertNotEqual(alias(Path), alias(<<Path/binary, "x">>)).

%% The domain prefixes exist so a record whose logical id happens to equal a
%% store path string cannot collide with that path's alias.
alias_and_current_domains_do_not_collide_test() ->
    Shared = <<"collision-candidate">>,
    ?assertNotEqual(alias(Shared), current(Shared)),
    ?assertEqual(43, byte_size(current(Shared))).

%% The derivation is the documented one, so an independent implementation in
%% another language can reproduce it from the spec alone.
derivation_matches_specification_test() ->
    Path = <<"odysee/claim-id/abc">>,
    Expected = hb_util:encode(crypto:hash(sha256, <<"odysee-alias:v1:", Path/binary>>)),
    ?assertEqual(Expected, alias(Path)).

-endif.
