# Dynamic Futures SHORT allocation

`FUTURES_WALLET_HALF_V1` replaces the former fixed 70 USDT budget and 35 USDT slot. At most two managed SHORT positions are allowed, still USDT perpetual, isolated, one-way, 1x, no auto-add-margin.

For each new entry: slot = floor(walletBalance / 2 to cents); permitted amount = min(slot, availableBalance), floored to cents. Wallet balance includes deposits, withdrawals, realized P/L, fees and funding; unrealized gains do not increase the allocation. Open positions are never resized when the wallet changes. The requested amount includes a reserve of max(1 USDT, 0.3%); quantity is rounded down with the existing price allowance and exchange filters. An exchange minimum is never met by increasing the budget.

Automatic, manual and pending POC entries share this calculation. A fresh signed account read just before submission rejects balance shrinkage, changed settings or expired signals. The durable pending intent records its approved budget, and recovered fills keep that budget. Pre-upgrade pending entries retain the original 35 USDT cap. Manual retries retain request identity and never place another order after an uncertain result.

Cancel error -2011 is not treated as success by itself: query the same identity again and require a terminal status. Active, unknown or mismatched orders remain blocked. A persisted -2011 halt can clear only after a successful management pass, verified account ownership, no pending operation, no external orders, and freshly reverified native guards for every remaining position. Recovery records an audit event and resets the signal boundary; it sends no order itself.

Deploy with `scripts/install-dynamic-short.sh FULL_SHA`. It stages surgical changes against installed sources, preserves local exit checks, runs mock execution tests, checks pending orders before/after service stop, backs up code and journals, and verifies the running policy. Rollback restores code, never trading journals. `scripts/check-dynamic-short.mjs` is a read-only check of actual balance, order counts, halt and BTC exchange minimum; no credentials are printed.

Historical installer tests explicitly rewind this release to their immutable prior contexts and matching tests. Current behavior is tested separately, including dynamic growth/shrinkage, final account changes, cancellation races, blocked recovery and UI limits.
