# Independent Binance live entry

The owner requested that observation methods also make independent entry decisions.
Binance now supports an explicitly enabled `independent_breakout` route alongside
the existing confirmed-quality V2 strategy. This implements the already registered
20-bar breakout rule; descriptive research statistics do not select strategies or
rewrite parameters. Colmex execution, manual orders and existing exits are unchanged.

## Decisions and safeguards

- A closed five-minute candle must exceed the preceding 20 highs, with volume at
  least 1.5 times their mean and mean dollar volume of at least $10,000 per bar.
  The shared MA100/200 downtrend veto applies; 204 continuous candles are required.
- No Spring, higher recovery pair or RSI ceiling is required for this route.
  Those conditions still apply to their original strategies. When both routes
  qualify on a symbol, the existing confirmed-quality route has priority.
- A signal expires at the next five-minute close. Fresh connected price and the
  current live candle must stay above the breakout level. Invalid, missing,
  gapped, stale or unfinished data cannot authorize an order.
- Signals must occur after explicit activation, trade resumption and the latest
  sale/reconciliation boundary. Filled pattern IDs are recovered from the journal
  across restarts. The final order path reevaluates candles, permission, price,
  signal identity and consumed patterns immediately before submission.
- Existing execution locking, persisted order reconciliation, account readiness,
  native protection, stablecoin exclusion, five-position limit, 20%-slot allocation,
  exchange minimums and fee reserve remain in the shared execution path.
  The existing risk budget may reduce the allocated amount. Binance stop distance
  remains the configured Settings percentage; existing holdings keep their exit
  monitor regardless of the new entry permission.
- Trade provenance uses `BINANCE_INDEPENDENT_BREAKOUT_V1`. Scanner decisions expose
  both routes and the selected route. Real outcomes remain separate from research
  observations and simulated trades. No profitability claim follows from enabling it.

## Owner installation and activation

Default configuration is disabled. Deploying the frontend alone cannot enable
the separate Binance VPS. Run the installer from `/opt/levi-binance` with the
reviewed full SHA and one explicit option:

- `--install-only`: installs code and preserves the existing route permission.
- `--enable-live`: enables the route with a new activation time. The next eligible
  newly closed candle may cause a real purchase under the existing account rules.
- `--disable-independent-entry`: stops this route from opening new positions;
  existing position protection and the original strategy continue running.

The installer stages and syntax-checks runtime files, runs offline regression
tests, backs up code and its dedicated systemd drop-in, restarts the existing
service, and verifies the public route metadata. It does not edit API secrets,
trade settings, journals or the original LIVE/AUTO flags. Failure restores code
and the previous route permission, but cannot reverse exchange actions already
executed while the service was running. Account/protection must be checked after
installation; a version marker alone is not account-readiness evidence.

## Validation

`node --test tests/binance-independent-entry.test.mjs` exercises independent
selection, disabled defaults, activation/sale boundaries, signal reuse, stale and
invalid market data, final submission, risk sizing, native protection calls, and
account/pause/funding/capacity blockers with synthetic data and a stub order sink.
The existing entry, protection and Colmex tests continue covering their own paths.
No real trade is used as a test.
