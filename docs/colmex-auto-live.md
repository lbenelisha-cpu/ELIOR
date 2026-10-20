# Colmex automatic LIVE trading — $100 / three positions

This is a separate execution worker, not a conversion or reset of the $10,000 paper portfolio. The account display remains public and read-only; there is no public order or activation endpoint. The feature ships **disabled**. No real order was placed for development or verification.

## Policy

- Account must be pinned to one active **LIVE USD** account and explicitly enable self trading and bracket protection. Production deploys only; previews cannot trade.
- Same five-minute Wyckoff engine and Spring-stage entry rule as the existing Colmex paper implementation. A setup after activation / the last exit, no older than 20 minutes, unused and not invalidated by current bid/ask is required. It does **not** import Binance's separate hourly trend filter.
- LONG cash EQUITY / ETF only; no CFD, derivatives, leverage or short selling. Watchlist: AAPL, MSFT, NVDA, AMZN, GOOGL, META, TSLA, AVGO, JPM, NFLX. Personal browser watchlist edits do not change it.
- Maximum **$100 share notional per entry**, before broker fees. Limit price allows up to 0.1% over the current ask, rounded to the broker tick. Quantity is rounded down to verified lot step × lot size. No minimum-lot / fractional-share assumptions: an unaffordable minimum quantity skips entry. Unleveraged `availableCash` (or `cashBalance` if absent), plus $5 cash headroom, is required. This headroom is not an estimate or ceiling on actual commission.
- Three occupied account slots maximum, counting **all manual positions and outstanding buys**. One outstanding mutation at a time; one entry per instrument. The worker never adopts or closes manual positions. Manual additions to a bot-owned position halt automatic actions for ownership review.
- Buy is IOC **limit**, with an attached absolute stop. Acknowledgment is not execution. Reconcile exact filled quantity and fill price before management. IOC rejection / no fill consumes the setup and waits for a new one.
- Initial stop: 10% below the entry limit, rounded up (may be slightly tighter relative to actual fill). Missing position protection after confirmed fill requests immediate closure of that exact position. A broker stop is not a guarantee of execution price or loss ceiling.
- For seven calendar days, only the original loss stop applies. Afterwards ratchet broker protection to retain 80% of the gain between actual entry and observed peak. Never lower the stop. RSI is display-only. Profit is not guaranteed; this change is not a tested profitability claim.
- Worker is scheduled once a minute, with a 24-second internal deadline. It checks owned positions first and scans one watchlist symbol per completed entry cycle, about ten minutes for ten symbols in normal operation. Protective actions, errors and deadlines slow scanning. This is **not a one-second monitor**; peaks between observations can be missed. Entry is limited to ordinary New York weekday hours, fresh completed 5m history and a fully open instrument. Broker quote responses do not expose source timestamps: receipt time cannot establish exchange freshness. Holidays/halts may prevent current data and entries.

## Durable order handling

Netlify Blobs, strong consistency, account-specific state with compare-and-swap. A lease and durable intent are written before POST / PATCH / DELETE. On a timeout or malformed response, do not retry the financial instruction. Reconcile by returned order ID or unique broker user comment. Pending execution reserves the worker; unresolved outcomes halt for review after ten minutes. Restart/redeploy preserves the ledger. Never clear an uncertain intent to get the bot unstuck without checking broker orders/history/positions first.

The worker polls through the broker API and may pause on broker permissions, rate limits or schema differences. Never interpret a missing / failed account response as zero exposure. A previously submitted broker stop remains during an application outage; trailing updates and emergency closure requests require a functioning worker/API.

## User activation (not performed by this change)

Existing server-side `COLMEX_API_LOGIN` / `COLMEX_API_PASSWORD` remain in Netlify production Functions scope. No passwords are entered in the public page.

In Netlify production Functions environment settings, the account owner sets:

| Variable | Value |
| --- | --- |
| `COLMEX_AUTO_ACCOUNT_ID` | Exact numeric LIVE USD account ID shown in the account panel |
| `COLMEX_AUTO_LIVE_ACK` | `I_ACCEPT_LIVE_100_USD_3_POSITIONS_V2` |
| `COLMEX_AUTO_LIVE_ENABLED` | `true` |

Redeploy after environment changes. The owner should verify account permissions, fractional share / lot rules and current broker fee schedule before activation. The page status changes to waiting/monitoring only when all opt-in settings match. It does not guarantee that a trade is eligible or that a worker cycle succeeded: inspect last successful cycle and entry reasons.

To disable, set `COLMEX_AUTO_LIVE_ENABLED=false` and redeploy. This stops **all** worker monitoring and new execution; existing positions are not liquidated and existing broker stops remain. Manage them directly at the broker when disabled. There is deliberately no anonymous browser start/stop button on the public account page.

## Validation

Mock-only tests cover disabled and preview behavior, cap and step rounding, manual/pending exposure, actual partial fills, no fills, unknown outcomes, write-ahead persistence failure, cross-invocation leases, externally changed positions, missing stops, seven-day protection, read-only status and no writer retries. Full repository tests are run before publishing. Real financial API requests are not part of verification.

Broker contract: https://clientapi.cglms.com/traderevolution/v1/swagger-ui/index.html (live `/v3/api-docs`); guide: https://guide.traderevolution.com/traderevolution-api/traderevolution-apis/client-api. Credentials authorization follows Colmex's supplied login/password instructions, not generic OAuth sections.

## Runtime compatibility correction (V2)

Production identity comes from the native handler `context.deploy.context`, not the build-only `process.env.CONTEXT`. Both status and scheduled monitor use the same adapter; preview context always overrides any environment value. The V2 release intentionally requires the updated acknowledgement ending `_V2`, so settings entered for V1 cannot begin trading just because this correction is deployed. The owner must update `COLMEX_AUTO_LIVE_ACK` and redeploy. No other activation setting changes. The status handler also uses Fetch API so Netlify supplies the native Blobs context automatically.

## Discontinuous broker history

An unexpected gap in five-minute broker history starts a new Wyckoff search on the latest contiguous segment. Ordinary close-to-open session gaps retain the existing exchange-session rule. Pivots from opposite sides of a missing candle are never joined, no synthetic candles are created, and fewer than three usable bars waits for history. Status reports discarded/usable counts and the new search boundary. A cooldown-only invocation does not clear the preceding failure or count as a completed market scan.
