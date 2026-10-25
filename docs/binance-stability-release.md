# Binance stability update

This release repairs state reconciliation, execution safety and private account reads. It does not enable the disabled volume/cost filters or retune Spring, RSI 0–30, hourly trend, the five-position allocation, or the saved exit percentages.

## Included

- Compare the recorded managed quantity with complete fresh wallet snapshots under the execution lock. Resolve owned order outcomes first. Two matching observations at least one second apart are required before reducing a quantity.
- Append a POSITION_RECONCILIATION event instead of deleting fills or fabricating a sale. Preserve the original entry, peak and consumed pattern. Remove confirmed absent holdings from the managed projection; retain confirmed reduced dust separately. Additional deposits do not automatically increase managed quantity.
- Exclude unsettled native partial fills from external adjustments, preventing the same sold quantity from being subtracted twice.
- Block entries while the journal, account reconciliation, pending orders or confirmed protection coverage are unresolved. Keep profit reinvestment suspended after an unvalued external adjustment; wallet reads and exits remain available.
- Validate market-sale filters and account data before cancelling owned protection. Re-read free quantity after cancellation. On a known failure after cancellation, attempt to restore protection. Never create overlapping protection while a market-order result is unknown.
- Validate replacement brackets and current data before cancelling an active bracket. Track recent verification, quantity coverage and unsettled native fills.
- Serialize stop/liquidation through the same execution lock. Add pause/resume of purchases separately from liquidation. Continue managing real LIVE holdings when viewing DEMO.
- Include canceled/expired partial executions in realized P&L, fee totals and trade counts.
- Normalize ISO RSI timestamps and recheck the original setup peak/current intrabar high before submission.
- Require the existing device authorization for private reads and maintenance endpoints. Forward only a valid bearer header through the fixed read-only proxy; never attach a shared server credential to public code. Health is public and contains no account data.
- Include OHLCV in the legacy daily-backtest fetcher. This repairs its input contract, not its equivalence to the live intrabar strategy.
- Add regression and real HTTP tests with external network calls disabled, and CI on Node 22/24.

## Release preparation

Deploy the frontend, read proxy and backend as a coordinated release from one reviewed commit. A one-file replacement of server.mjs is insufficient. The new runtime dependencies include:

- lib/live-journal.mjs
- lib/live-wallet-reconciliation.mjs
- lib/order-has-fill.mjs

Older selective-file installers do not package this complete release. Use a complete versioned checkout/release, including the existing dependencies and updated frontend assets. Preserve environment configuration and every durable state file; do not reset the action journal, pending identities, protection identities, allocation baseline, device sessions or trade settings.

The backend now rejects unauthenticated private reads. Existing paired devices reuse their saved token. Other devices must use the existing pairing flow. Refresh the page after the coordinated release. The proxy does not bypass this requirement.

Before switching the service, record the current code revision and back up durable state for investigation. Confirm the existing journal is present and readable. Stop the old process before switching code so it cannot run mixed module versions. Starting the updated service with LIVE and AUTO_EXECUTION enabled continues the user's configured trading, and can execute exits already triggered by current prices. This preparation has not started or changed the production service.

## Post-release acceptance

1. Inspect authenticated /api/binance-readiness and account balances. Wait for two fresh account observations where a reduction is detected.
2. Confirm that absent historical entries are no longer active and any real remainder is accounted for. Inspect appended adjustment events; there must be no invented SELL or realized profit.
3. Verify the real open orders at Binance: symbol, client identities, quantity, stop and target. App status alone is insufficient for deployment acceptance.
4. Confirm readiness reports fresh, matching protection coverage for every managed holding; inspect the reason for any entry block.
5. Confirm the scanner's RSI includes the current candle when fresh data is present and that the existing paired phone can read the account/journal.
6. Confirm pause-only leaves exits active. Viewing DEMO must not stop LIVE protection monitoring.
7. Confirm private endpoints reject a request without a token, while the authenticated proxy and device flow work.

Do not perform a test trade solely to validate deployment without the user's authorization.

## Limitations and rollback

Cancellation and creation are separate Binance operations. Preflight and recovery reduce exposure but cannot guarantee zero time without a bracket during a network failure. A failed or unconfirmed restoration is reported; existing software exits continue when fresh prices and execution are available.

Wallet reductions cannot reconstruct the price, fees or economic reason for unrecorded external activity. Such adjustments deliberately remain unknown for realized-profit reinvestment. Historical fill/fee backfill and a faithful live-strategy backtest are separate work.

After the new release writes reconciliation events, do not roll back to code that ignores those events: doing so would resurrect old managed positions. Never restore an old journal over newer exchange executions. Any rollback must preserve pending/protection identities and use a reader compatible with the updated event type, followed by fresh account reconciliation.

The normal test command is npm test. Legacy tests outside tests/*.test.mjs remain outside this release's supported suite; the audit describes their existing path and obsolete-expectation failures.
