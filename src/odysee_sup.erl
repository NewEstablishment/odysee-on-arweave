-module(odysee_sup).
-behaviour(supervisor).

-export([start_link/0, init/1]).

start_link() ->
    supervisor:start_link({local, ?MODULE}, ?MODULE, []).

init([]) ->
    Children = [
        #{
            id => hb_odysee_homepage,
            start => {hb_odysee_homepage, start_link, []},
            restart => permanent,
            shutdown => 5000,
            type => worker,
            modules => [hb_odysee_homepage]
        }
    ],
    {ok, {#{strategy => one_for_one, intensity => 3, period => 10}, Children}}.
