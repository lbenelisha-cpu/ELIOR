# Automatic research-linked paper portfolios

`/trader-research#auto-paper` shows separate fictional Binance/USDT and Colmex/USD ledgers. This is forward paper observation, not a historical backtest or a broker account. It cannot place real orders or activate live trading. Existing live engines and settings are unchanged.

The production-only Netlify function `trader-auto-monitor` runs every five minutes. No browser needs to remain open. `trader-auto-status` is GET-only and never initializes state or invokes a scan. The page refreshes that read-only status once a minute while visible. Until the first committed scheduled run, the UI says there is no saved cycle. A last cycle older than fifteen minutes is visibly stale.

## Data and scheduling

- Binance public `data-api.binance.vision/api/v3/klines`: BTCUSDT, ETHUSDT, SOLUSDT, BNBUSDT, XRPUSDT.
- Twelve Data via the existing quota-controlled `td` cache: AAPL, MSFT, NVDA, AMZN, GOOGL. These are not Colmex broker quotes. Requires existing `TWELVE_DATA_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and market reservation/cache schema. The calendar supports 2026–2028; unknown sessions fail closed.
- Five-minute closed OHLCV bars, at least 204, no duplicate or missing intervals except known stock session boundaries. Stock session times are New York regular sessions, requested timestamps UTC. Freshness limit seven minutes. Incomplete/future candles are excluded and invalid or unavailable data blocks entry.
- Every open/pending asset is read first in each cycle, plus two rotating candidates per platform; watchlist coverage up to fifteen minutes. Source rate limits and scheduler delays can extend this. Failure on any held asset blocks all new entries for that portfolio. Existing positions remain open if their data is unavailable.
- Separate strong-consistency Netlify Blobs store `levi-trader-auto-paper-v1`, keys `binance` and `colmex`; never shared with live or older simulation ledgers. Compare-and-swap guards cycle commits. Concurrent runs can read data but only one ledger commit succeeds. Same or older five-minute cycle IDs are ignored. Each portfolio commits independently.

## Explicit simulation assumptions

Both portfolios start with 10,000 virtual units; no transfers or real balances. Fixed defaults: at most five positions/pending signals, allocation <=20% including estimated two-sided fees, 0.1% fee per side. Confirmed quality risk sizing further caps planned loss at eight virtual units per entry, including estimated round-trip costs. Colmex uses whole shares; Binance quantities are rounded down to eight decimals. Exchange lot/notional filters are not modeled.

Entry reuses `qualityEntry`: confirmed Spring or early-wave, higher second recovery, MA100/200 falling-trend gate, confirmation volume >= prior twenty-bar average. Only signals strictly after activation/last consumed signal or sale are eligible. A signal is recorded first and may fill only at a later observed closed candle whose close time is after the server recorded the signal. The fill rechecks setup boundaries/expiry and intervening structural breaks. No same-candle fill or historical catch-up entry. Signal validity is fifteen minutes; some candidates will expire before rotation finds them.

Frozen demo settings are separate from actual account settings: 1% initial Binance stop; Colmex uses the existing ATR/structure-aware sizing with a 3% maximum stop. Trailing activation +5%, gap one percentage point of entry, take profit +50%. These defaults are simulation inputs, not personalized investment recommendations or instructions to change a real account.

Exits inspect **only the latest observed close** each cycle and fill at that sampled close. They do not replay unobserved intrabar peaks/stops, guarantee a stop price, model spread/slippage/liquidity or corporate actions, or guarantee risk stays within the planned amount. Portfolio equity uses last saved marks and entry/sold fees; it excludes future liquidation fees for open positions. The UI exposes per-position quote timestamps and data failures. Returns are not evidence of achievable real execution.

## Research context and operating state

At a new qualifying signal, the time budget permitting, attach up to three dated Yahoo Finance RSS links; stocks additionally carry available SEC annual/quarterly data. `SEC_USER_AGENT` must contain an operator-supplied real contact for SEC requests; never invent one. Missing configuration is `CONFIG_REQUIRED`. Crypto company financials are `NOT_APPLICABLE`. Missing news is never interpreted as positive sentiment. Context is informational and does not drive entry. Research may be skipped if the cycle's remaining time is insufficient. News and financial data are timestamped snapshots, not a recommendation engine or all eleven upstream Trader Skill skills.

Set `TRADER_PAPER_ENABLED=false` in the production environment to stop new simulated entries; existing paper positions continue receiving exit evaluations. There is no live-mode switch or mutation endpoint in this feature. The journal retains the latest 300 signals/buys/sells/cancellations per portfolio; cumulative accounting and counts survive truncation. The UI shows the last thirty events.

Tests exercise both real strategy paths, activation boundaries, delayed fills, invalid/stale data, cash/fees, exit accounting, concurrency, source failure, scheduler guards and read-only status. They make no broker requests.
