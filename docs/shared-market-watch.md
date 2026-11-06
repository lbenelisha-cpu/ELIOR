# Shared LONG / SHORT watch

`SHARED_LONG_SHORT_WATCH_V1` uses the existing Spot watch universe (`SYMBOLS`)
as the common asset list. It does not expand Spot entries or change their ranking.
Automatic SHORT candidates now come from verified matching contracts for this
same list, instead of an independent top-50 Futures volume ranking. Instruments
without an eligible matching contract remain visible with a reason.

Only names in the explicit bStocks catalog lose the final B when identifying an
underlying stock. GOOGLBUSDT maps to GOOGLUSDT only if exchangeInfo confirms the
exact symbol, GOOGL base asset, TRADING status, PERPETUAL type and USDT quote and
margin assets. Crypto uses exact base units: BNB is not shortened, and SHIB is
not silently substituted with 1000SHIB. Ambiguous/duplicate, missing, settled or
different-margin contracts are unavailable. No symbol mapping changes quantities
or borrows Spot prices for Futures evaluation.

An independent `SharedMarketWatch` reads only public exchangeInfo, 5m klines and
bookTicker. It schedules one eligible contract every two seconds, with a single
in-flight scan, metadata refresh every five minutes and a 30-second backoff on
metadata failure. Individual market-data errors do not block later symbols.
Removed members are discarded; observations expire after three minutes or at
the end of the measured open candle, whichever is earlier. A first pass through
60 symbols takes roughly two minutes plus request latency. Unsupported symbols
are listed immediately after metadata verification without waiting for a scan.

Observation continues when entries are disabled, paused, short of free funds,
at capacity, or halted for journal/account/protection issues. It uses the existing
SHORT technical rules, activation/resume boundaries and consumed-pattern data,
but reports technical readiness separately from the execution blocker. There is
no order, account, configuration write, journal mutation or halt release in the
observer. Existing position management remains on its independent execution
cycle; it does not wait for observation. New automatic SHORT entries still run
all existing permission, balance, budget, ownership, margin, protection and fresh
signal checks. Watch membership is checked again immediately before dispatch.
Manual POC behavior and all exit percentages are unchanged.

The authenticated attention board joins Spot and Futures checks using the verified
mapping. It shows both directional checks and their execution blockers. The SHORT
panel also lists the entire shared universe, including unscanned or unsupported
members. These views remain explicitly observational and do not claim that an
order is approved. Legacy execution-check records remain available separately.
Older servers retain their prior UI until the policy marker is present.

Deploy the static UI through Netlify. On the Binance VPS run the pinned revision
of `scripts/install-shared-market-watch.sh`. It stages exact additive patches to
the installed server, runner and attention integration, preserving local changes
(including the deployed contract-price protection lookup). It requires the
previous consolidation/settings update, validates staged trading behavior before
stopping the service, checks pending intents before and after stopping, backs up
code, and verifies policy markers, unchanged activation flags and exit settings.
Rollback restores code only; execution journals are retained. A successful install
does not itself confirm every contract's market-data availability or execute a
trade. Colmex trading code is not modified by this Binance-specific update.

The installer supports the existing SHORT runner with or without the optional
server-side POC reservation hook. When that hook is absent, an exact reviewed
runner-constructor anchor installs only the shared observer; it does not install
POC, alter execution controls or replace the server file wholesale. Both layouts
are checked before staging. Unknown or duplicate anchors still abort before any
installed file or service change, and report a named patch ID for diagnosis.
