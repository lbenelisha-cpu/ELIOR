# Profit floor at +4%, trailing gap one entry percentage point

Policy `PROFIT_FLOOR4_TRAIL1PP_STOP1_V1` replaces fixed take profit for managed LIVE Binance and Colmex positions, including existing owned positions. Initial loss stop: entry × 0.99. At an observed peak of entry × 1.04, arm the profit floor without selling merely because activation was reached. Thereafter stop = max(entry × 1.04, observed peak − entry × 0.01, previously saved stop). A +10% peak protects +9%, not +8.9%. The stop never decreases.

Entry gates and sizing are unchanged. Legacy fixed and older exit functions remain available for prior research; current runtime entries and owned holdings use the new policy. Externally acquired wallet holdings remain display-only and are not enrolled.

Binance uses existing live-price monitoring and durable journal peak storage. Journal persistence now includes policy identity and activation state, so a restart does not discard the raised floor. Managed manual buys through this application use the same policy; all fills reanchor levels to actual execution price. New reason names participate in demo cooldown and drawdown accounting.

Colmex new buys include native initial 1% stop and no fixed take-profit order. Existing fixed TP is removed using PATCH takeProfit:null while retaining or raising SL. Confirmed broker stops are never lowered. Removal and stop changes use durable PROTECTION intents and both broker fields must reconcile before further work. Broker contract verified from `https://clientapi.cglms.com/traderevolution/v1/v3/api-docs`, schema `ModifySlTpOnPosition`: omission preserves TP, null removes it. Snapshot/config omissions are not proof of removal.

At the exact +4% activation bid, a new native stop at the bid could immediately execute or be rejected. The worker retains the existing broker stop until price is above the rounded new floor; the application monitors the activated floor meanwhile. Colmex peaks and SL amendments follow its existing minute worker, not Binance's tick cadence. Neither the trigger nor observed peak is a guaranteed execution outcome or net return. Fees, spread and gaps still apply.

Charts label +4% as activation, show the observed peak and current trailing floor with its gross protected P/L, and have no fixed profit ceiling. External manual holdings keep clearly labeled illustrative values. No extra polling is added.

Installer: `scripts/install-binance-trailing-profit.sh <reviewed SHA>`. It stages and checks modules, backs up code, then restarts and checks service health. It does not submit orders itself. The running service may immediately exit an existing owned position whose saved peak implies a stop above the current price. No account state, trade journal or credentials are overwritten.

Validation: inclusive -1% boundary, no sale on first exact +4% activation, +4% floor, +10%→+9%, monotone stops, serialized restart, weighted fills, legacy position migration, broker TP cancellation/unknown outcomes, preservation of tighter native SL, chart amounts and external-ownership isolation. All broker mutations in tests are mocked; no real trade or LIVE cycle is invoked.
