# Binance stop loss from Settings

The owner requires the stop-loss percentage to come only from Settings. Before this fix, automatic entries could widen it using ATR/structure up to 3%, and `riskPlan.stopLossPct` could override later settings changes. A 1% setting could therefore coexist with a 3% stop on a managed position.

`SETTINGS_ONLY_V1` removes both overrides for Binance. New entry evaluation, the final buy request, actual fills, restored LIVE holdings, DEMO/paper holdings, and the native protection minimum-notional check use current validated settings. Manual buys also record those settings before the fill. Historical risk-plan data is retained as entry provenance, not used as an exit rule. Colmex retains its previous volatility-based and frozen-stop behavior.

For entry 100 and configured stop 1%, the initial trigger is 99 regardless of ATR, pattern low, or an old 3% risk plan. The exchange may round the trigger upward to its allowed tick. The existing profit activation and trailing gap remain governed by Settings. Earned trailing floors and tighter verified broker protection never move down; the configured loss percentage does not erase them. Execution price can differ from the trigger.

Automatic order sizing keeps the existing dollar risk budget, cash reserve, position limits and exchange minimums, now measured using the configured stop. A wider percentage explicitly chosen in Settings may reduce size. A valid configured value above 3% is no longer rejected by a hidden volatility cap. Entry confirmation, trend, volume, freshness and execution reconciliation checks remain in place.

Tests use offline broker substitutes. They cover exact configured percentages across volatility scenarios, a restored 3% position exiting at the current 1% threshold, DEMO/paper parity, tighter/trailing protection, manual fill metadata, native bracket replacement and protected minimum notional.

## Deployment and verification

Publishing a branch or frontend does not update the Binance VM. The existing `scripts/install-confirmed-quality.sh FULL_COMMIT_SHA` now checks the settings-only policy before and after installation, with its existing code backup and rollback. No credentials, stored settings, account permissions or position journals are changed by this patch.

Installation affects existing managed LIVE positions. If the current price has already crossed the configured stop, the existing exit monitor may submit a sale after installation. A native stop is replaced only through the existing reconciled cancellation/create flow, and an already tighter stop is retained. Deployment must be distinguished from a confirmed order: authenticated position/exit logs and exchange order status are required to verify the result. The public `/api/binance-mode` must report `confirmedQuality.stopLossPolicy === "SETTINGS_ONLY_V1"`; that marker alone does not prove that any particular holding has a verified protective order.
