# Binance channel SHORT

This adds a separate USDⓈ-M USDT perpetual executor. It does not reinterpret Spot SELL as SHORT, change Spot entry rules, or implement Colmex SHORT.

## Owner policy

- Maximum 70 USDT capital allocation, two positions, equal 35-USDT slots, 1x and Isolated. Each order uses at most 34 USDT notional, reserving 1 USDT per slot for costs. Lot rounding and partial fills may leave different actual amounts.
- No transfers, withdrawals, loans, auto-add margin, portfolio margin, Multi-Assets or Hedge Mode. Empty candidate symbols can be configured to Isolated and 1x. Auto-add must already be off.
- Realized losses, USDT commissions and funding reduce the available budget; deposits and profits cannot raise the 70-USDT ceiling. Income truncation, non-USDT costs and a history period over 80 days require review. This allocation cap is not a guaranteed maximum loss: gaps, execution costs and funding can exceed reserves.
- Scan the top 50 eligible USDT perpetuals by quote volume. 5m futures candles; 50 frozen pre-breakout bars; confirmed swing channel with at least two touches on each side; falling regression and price below its center; fresh closed candle crossing the lower boundary; volume at least 1.5 times the prior 20-bar average and mean dollar volume at least 10,000. Reject gaps, stale quotes, current prices at/above the lower channel thresholds or regression center, consumed patterns and targets already reached.
- Binance SHORT exit policy `FUTURES_SHORT_SETTINGS_V2`: TP = actual entry price × (1 − configured takeProfitPct / 100). This applies to channel and POC entries and existing managed Binance SHORTs. The channel target remains entry-analysis evidence and is no longer an exit trigger. Owner stop-loss percentage, trailing activation and trailing gap are read from existing settings. A SHORT trailing stop follows the lowest observed ask, and never loosens a previously earned stop. This is sampled, not a tick-by-tick guarantee. The Colmex caller retains its existing channel policy.

## Settings-based SHORT exit update

Run `scripts/install-short-settings-exit.sh <reviewed-full-sha>` after fetching the reviewed commit. It stages recognized patches to the installed runner, policy and settings endpoint, tests them with the installed modules, validates current SHORT settings, backs up code and the Futures journal, restarts the service, and verifies the advertised exit policy. It also installs the GET-only `scripts/diagnose-futures-ownership.mjs` diagnostic. It preserves entry flags, halts, historical records and configured percentages. An unresolved entry/exit intent blocks installation. Unknown patch context is rejected before changing deployed code. Runtime health verification does not prove exchange acceptance.

The staged test API supports both book quotes and contract-price reads used by deployed protection checks. Synthetic contract prices follow the current test quote, including low-priced fills. A failed staged test exits before stopping the service or replacing installed files; it does not indicate a live exchange order was sent. Local runner integrations are preserved, and unknown API reads still fail the tests.

For new entries, TP is computed from the actual weighted fill. For existing positions, each management cycle recalculates TP from current settings; a replacement native TP is installed and verified before the former one is cancelled. Existing tighter stops and armed trailing protection are retained. An old native target can still trigger while deployment or replacement is in progress. Protection failures and manual close requests remain independent exits.

The configured TP must be below 100% while Binance SHORT is enabled, held or pending. The global settings endpoint rejects an impossible SHORT target before saving; entry validation rejects it before placing an order. The UI reports settings-based exits only after the running server advertises the new policy. The shared exit helper opts Binance in explicitly, preserving Colmex and LONG behavior.

## Execution and recovery

Default disabled. Enabling needs both `BINANCE_FUTURES_SHORT_ENABLED=true` and a valid `BINANCE_FUTURES_SHORT_AFTER` boundary; only later signals qualify. Common pause/resume applies to entries; existing owned positions remain managed. Stop-all includes owned Futures positions. Futures ledger and API host are separate from Spot. Account data is returned only to authenticated devices in `/api/binance-mode`.

Entry uses a bounded SELL LIMIT IOC. The actual fill creates the position, including partial fills. Native BUY closePosition STOP_MARKET and TAKE_PROFIT_MARKET algos are verified using their saved IDs. Trigger basis is CONTRACT_PRICE. A tighter native stop is installed and verified before removing the previous one. Software exits use BUY MARKET reduceOnly. The two native orders are not an atomic bracket: there is a short unprotected window after entry; protection failure triggers an attempted reduce-only close and a persistent entry halt. Network failure may delay that close.

A durable intent is saved before each trade or protection write. Unknown trade results are queried by the original ID and are never blindly resubmitted. An unresolved trade can block subsequent software orders; already installed native protections remain with Binance. Pending algo IDs are queried, not recreated as if they never existed. The serialized loop runs nominally every two seconds; network latency and retries increase that interval.

Unknown positions/orders block entries. Manual changes to direction, size increases or entry price stop automatic ownership assumptions. Do not share an owned Futures symbol with manual trading. A smaller exchange position is reconciled to the remaining quantity. Keep the journal (`BINANCE_FUTURES_SHORT_FILE`, default `LIVE_LOG_FILE + '.futures-short'`) across restarts and upgrades. Do not delete it to clear a halt.

A persistent `halt` requires checking the saved pending ID, actual positions and native orders before recovery. No automatic reset of a reconciliation/protection failure is provided in this release. Contact the maintainer with the sanitized status; do not send API secrets.

## Owner-run installation

Fetch the reviewed commit, extract `scripts/install-futures-short.sh`, then run with the full SHA and one of:

- `--install-only` (default): preserve existing activation state; initially disabled.
- `--enable-live`: enable SHORT entries with a fresh activation boundary on first activation. Existing active boundaries survive repeat installations.
- `--disable-entries`: disable new SHORTs, continue managing owned positions.

Installer patches recognized integration anchors, tests against installed dependencies, backs up changed files and restarts `levi-binance`. A failed service verification restores code/configuration. It does not roll back exchange trades or delete the Futures journal. No credentials are printed. Service port verification currently assumes the existing port 8080.

First verify the authenticated SHORT panel and the GET-only `scripts/check-binance-futures-access.mjs`. A zero balance intentionally blocks entry. Passing offline tests or installing the code does not prove a live fill or native protection acceptance. Live order execution has not been tested against the owner's account by the author.

Official endpoint contracts: [Futures trade API](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/trade), [Futures account API](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/account).

Entry recalibration: a previous high above the breakout ceiling is allowed if the fresh price is now below it. The current live bar must still be present and consistent. Closed-bar confirmation, volume, expiry, budgets and protection remain unchanged.

## Protection visibility and operator release

Binance can acknowledge a conditional order before `GET /fapi/v1/algoOrder`
can find it. The runner now persists the acknowledged exchange `algoId` and
checks that identity, falling back to the persisted client ID for older journals.
Only `-2013` reads are retried: four waits of 150, 300, 600 and 950 ms, with five
reads total. No POST is repeated. Both IDs and all protection fields must still
match; every other API/identity failure keeps the fail-closed behavior.
A continuing failure closes the owned position and leaves the durable halt.

`install-futures-protection-visibility.sh <reviewed-sha>` installs this fix with
runtime tests, a code backup and a version guard. It never clears a halt.
After an operator explicitly requests resumption, run
`node scripts/release-futures-short-halt.mjs --release` on the VPS. It accepts only
the reviewed `FUTURES_API_-2013` / `PROTECTION_FAILURE` incident, confirms flat
Futures positions, no pending or open orders, the account modes, and inactive
incident protections. It stops the service, repeats the checks, backs up the
journal, records the release, and starts the service. It never places/cancels an
exchange order. Funding/budget history, closed positions and consumed signals
are retained. Entry must use a signal after the release time. Other halts and
unresolved identities require separate investigation.
