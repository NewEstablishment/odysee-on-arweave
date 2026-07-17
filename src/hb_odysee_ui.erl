%%% @doc Publish a built static UI into a node's store as an Arweave
%%% path-manifest message, servable at `GET /<ManifestID>' through
%%% `~manifest@1.0'. Each file in the build directory is written to the
%%% cache as an uncommitted (content-addressed) message carrying its
%%% `content-type', then referenced from the manifest's `paths' map. The
%%% manifest message itself carries `device: manifest@1.0', so it serves
%%% its index and assets on any node whose store can read the IDs -- no
%%% request hook required.
-module(hb_odysee_ui).
-export([publish/2]).

%% @doc Publish the directory at `Dir' and return the manifest ID.
publish(Dir, Opts) ->
    maybe
        {ok, Files} ?= files(Dir),
        {ok, Paths} ?= write_assets(Dir, Files, Opts),
        ManifestJSON =
            hb_json:encode(
                #{
                    <<"manifest">> => <<"arweave/paths">>,
                    <<"version">> => <<"0.1.0">>,
                    <<"index">> => #{ <<"path">> => <<"index.html">> },
                    <<"paths">> => Paths
                }
            ),
        Manifest =
            #{
                <<"device">> => <<"manifest@1.0">>,
                <<"content-type">> => <<"application/x.arweave-manifest+json">>,
                <<"data">> => ManifestJSON
            },
        {ok, _} ?= hb_cache:write(Manifest, Opts),
        {ok, hb_message:id(Manifest, none, Opts)}
    end.

%% @doc List every regular file under `Dir', as paths relative to it.
files(Dir) ->
    case filelib:is_dir(Dir) of
        false -> {error, not_a_directory};
        true ->
            Absolute =
                filelib:fold_files(
                    Dir,
                    ".*",
                    true,
                    fun(File, Acc) -> [File | Acc] end,
                    []
                ),
            Prefix = string:trim(Dir, trailing, "/") ++ "/",
            {ok,
                [
                    hb_util:bin(string:prefix(File, Prefix))
                ||
                    File <- lists:sort(Absolute)
                ]
            }
    end.

%% @doc Write each file as a content-typed message, returning the
%% manifest `paths' map of relative path to message ID.
write_assets(Dir, Files, Opts) ->
    write_assets(Dir, Files, #{}, Opts).
write_assets(_Dir, [], Paths, _Opts) ->
    {ok, Paths};
write_assets(Dir, [Rel | Rest], Paths, Opts) ->
    maybe
        {ok, Bytes} ?= file:read_file(filename:join(Dir, Rel)),
        Asset =
            #{
                <<"content-type">> => content_type(Rel),
                <<"body">> => Bytes
            },
        {ok, _} ?= hb_cache:write(Asset, Opts),
        ID = hb_message:id(Asset, none, Opts),
        write_assets(
            Dir,
            Rest,
            Paths#{ Rel => #{ <<"id">> => ID } },
            Opts
        )
    end.

%% @doc Map a file name to its `content-type' by extension.
content_type(File) ->
    case hb_util:to_lower(filename:extension(File)) of
        <<".html">> -> <<"text/html">>;
        <<".js">> -> <<"application/javascript">>;
        <<".mjs">> -> <<"application/javascript">>;
        <<".css">> -> <<"text/css">>;
        <<".json">> -> <<"application/json">>;
        <<".svg">> -> <<"image/svg+xml">>;
        <<".png">> -> <<"image/png">>;
        <<".jpg">> -> <<"image/jpeg">>;
        <<".jpeg">> -> <<"image/jpeg">>;
        <<".gif">> -> <<"image/gif">>;
        <<".webp">> -> <<"image/webp">>;
        <<".ico">> -> <<"image/x-icon">>;
        <<".woff">> -> <<"font/woff">>;
        <<".woff2">> -> <<"font/woff2">>;
        <<".ttf">> -> <<"font/ttf">>;
        <<".otf">> -> <<"font/otf">>;
        <<".txt">> -> <<"text/plain">>;
        <<".xml">> -> <<"application/xml">>;
        <<".webmanifest">> -> <<"application/manifest+json">>;
        <<".map">> -> <<"application/json">>;
        <<".wasm">> -> <<"application/wasm">>;
        <<".mp4">> -> <<"video/mp4">>;
        <<".webm">> -> <<"video/webm">>;
        _ -> <<"application/octet-stream">>
    end.

-ifdef(TEST).
-include_lib("eunit/include/eunit.hrl").

publish_test() ->
    Opts = #{ <<"store">> => hb_test_utils:test_store() },
    Dir = filename:join(["/tmp", "hb-odysee-ui-test"]),
    ok = filelib:ensure_path(filename:join(Dir, "assets")),
    ok =
        file:write_file(
            filename:join(Dir, "index.html"),
            <<"<html><body>odysee</body></html>">>
        ),
    ok =
        file:write_file(
            filename:join([Dir, "assets", "app.js"]),
            <<"console.log('odysee');">>
        ),
    {ok, ManifestID} = publish(Dir, Opts),
    {ok, Index} =
        hb_ao:resolve(
            <<ManifestID/binary, "/index.html">>,
            Opts
        ),
    ?assertEqual(
        <<"<html><body>odysee</body></html>">>,
        hb_ao:get(<<"body">>, Index, Opts)
    ),
    {ok, App} =
        hb_ao:resolve(
            <<ManifestID/binary, "/assets/app.js">>,
            Opts
        ),
    ?assertEqual(
        <<"application/javascript">>,
        hb_ao:get(<<"content-type">>, App, Opts)
    ).

-endif.
