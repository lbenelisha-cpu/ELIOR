# Fixed exits, Binance and Colmex LIVE

Authorized policy: take profit at entry × 1.04 and loss stop at entry × 0.99, with no minimum holding time. Exit the entire managed quantity. No entry gates, caps, external ownership rules or post-sale signal rules change.

Current `spring_rsi_live` and manual entries use `FIXED_TP4_SL1_V1`. Binance reanchors both levels to the actual weighted execution price. Existing managed Binance, demo and Colmex positions migrate at runtime. Legacy exit exports remain available for historical research and are not the LIVE policy. External read-only wallet holdings are not adopted.

Colmex sends native 1% loss / 4% profit percentage brackets with its IOC buy, then reconciles rounded absolute levels from the confirmed execution price. Existing owned positions receive an absolute SL/TP update. A durable PROTECTION intent is saved before PATCH and reconciled against **both** broker values; an uncertain outcome is not blindly retried. A position closed at the broker clears the outstanding protection intent. The existing minute worker checks exits as a backup. Missing broker stop retains the exact-position emergency-close behavior.

The chart shows the entry, stop, target and gross planned profit/loss in USD or USDT, using actual held quantity, only for a real managed fixed-policy position. Green/red areas mark planned reward and risk. It adds no polling requests. Amounts exclude fees, and neither the price nor the monetary loss is a guaranteed execution ceiling.

API reference for native brackets and absolute position modification:
https://guide.traderevolution.com/traderevolution-api/traderevolution-apis/client-api/trading

Binance VM installer: `scripts/install-binance-fixed-exits.sh <reviewed SHA>`. It stages and syntax-checks all modules before copying, creates a code backup, restarts and checks service health. The installer submits no order itself; the running service can immediately close a position already outside the new thresholds. Netlify deploys the Colmex worker and both chart interfaces from main.

Validation uses mock fills/quotes/broker writes, including boundary prices, legacy position migration, durable protection reconciliation, actual execution anchoring, external ownership isolation and chart risk calculations. No LIVE orders or worker cycles are invoked as tests.
