# Manual Binance LIVE trades

The selected chart asset has explicit Buy and Sell-all controls. Buy opens a USDT amount dialog; the chosen quote amount is sent unchanged (apart from flooring quote precision), rather than replaced by automatic allocation. Buy opens a new position only, requires an available slot, respects the configured live order cap, and reserves 0.2% funding for fees. It is blocked while trading is paused. Existing holdings cannot be averaged into a new position by this control. Sell-all means the entire available/free wallet balance of the selected asset, including holdings outside the bot; it does not sell the entire portfolio or locked amounts. Quantity is floored by decimal integer arithmetic to the common LOT_SIZE and MARKET_LOT_SIZE step and checked against minimum/maximum quantity and minimum notional. Unavoidable rounded dust may remain. The exchange applies final market validation and execution price.

Controls submit only after an explicit modal confirmation, use the existing BINANCE_CONTROL_TOKEN bearer authorization, and are LIVE-only. They do not use the push pairing token or expose Binance credentials. The backend acquires the same lock as the automatic execution cycle before recovering pending orders, checking balances and sending any new manual order. Mode/stop changes are rejected while that execution lock is held. This prevents manual orders racing automatic fills or being submitted into a changed account mode.

Every modal uses a stable request identity. The backend durably records it before execution, fingerprints the side/symbol/amount, and returns the prior result when repeated. Ambiguous Binance outcomes retain their existing persisted market-order identity; status checks reconcile the same order without reposting. Definitive rejection allows another explicitly confirmed attempt. Browser timeout/network failure presents a status-check control, never an automatic order retry. A crash between local request recording and exchange submission can leave an unresolvable request that requires operator review; safety takes precedence over resubmission.

Manual buys record entrySource MANUAL without fabricated Wyckoff pivots, and enter the existing quantity/high-water/exit ledger with the current 10% stop and seven-day profit-hold/gain-retention policy. Manual sells bypass the seven-day hold by explicit request. Their existing execution journal feeds trade counts, chart fill markers and opt-in cloud push notifications. Automatic future entry still requires the ordinary fresh post-sale Wyckoff pattern. Selling untracked wallet quantities may leave net P&L unavailable when entry cost was not recorded; no cost basis is invented.

Deployment requires `server.mjs`, `lib/binance-manual-trades.mjs` and `lib/live-buy-allocation.mjs` from the same revision, with existing backend libraries retained. The frontend enables controls only when GET `/api/binance-mode` advertises `manualTrading.version: 1`. Old backends keep the buttons disabled with an update notice; installing only the frontend cannot accidentally use the old amount-overriding endpoints. No actual order was sent while implementing or testing. SSH from this workspace was network-unreachable, so backend installation must be completed through the owner's existing SSH terminal.

Validation: 356 repository tests and an offline DOM scenario cover exact quote amounts, full free-wallet sale versus automatic tracked-quantity sale, minimums/caps/slots, decimal rounding and tiny assets, persisted request deduplication, uncertainty recovery, LIVE authorization/mode locks, normal exit tracking, confirmation/cancel/double-click behavior, symbol changes and old-backend capability gating.

## Manual execution priority

Manual requests wait up to eight seconds for the existing execution to finish,
then take priority over new automatic cycles. A waiting timeout cancels only
that waiting request; it never releases an active order lock or submits later.
Idle one-second monitoring still observes and persists peaks, but only performs
exchange account/recovery work when an exit, an entry, or a pending order needs
it. Public and signed Binance requests have a 15-second network deadline;
ambiguous submissions retain their persisted identity for reconciliation.

Install this revision with the same pinned installer command. This is a server
update; publishing the web page alone does not update the trading process.
