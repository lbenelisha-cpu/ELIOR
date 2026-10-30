# Manual purchases filled in several trades

Binance can execute one Spot buy order as several fills. The external-cost
adapter previously discarded their order ID. When old dust had been removed
outside the recorded Spot history, full-history replay no longer matched the
wallet, and the recovery path tried only the most recent fill. A valid split
purchase therefore had unknown cost and could not be enrolled by the existing
manual-holding importer. An unrelated wallet quantity matching just the last
fill could also be incorrectly accepted by that recovery path.

The adapter now preserves a validated order ID. Recovery starts with the first
recorded fill of the latest buy order and replays all subsequent fills and
sales. It still requires the resulting quantity to match the wallet. Different
orders are not merged into a guessed baseline, missing identifiers retain the
legacy behavior, and unexplained deposits or reductions remain unverified.
Full-history weighted cost and base/quote commission treatment are unchanged.

This correction serves both read-only cost display and the existing manual
holding importer. It does not create an extra purchase. It does not bypass
account readiness, enrollment checks or broker-protection verification.

## Validation and activation

`tests/binance-manual-order-reconciliation.test.mjs` uses synthetic split fills
to reproduce the failure and verifies recovery, rejection of a last-fill-only
wallet, distinct-order boundaries, partial sales and display-only enrichment.
Tests make no exchange calls.

The separate VPS must load the two corrected modules; a Netlify deploy does not
update that running process. `scripts/install-binance-split-order-cost.sh` stages
the two modules against installed dependencies, checks that installed files
match the reviewed parent revision (or already match the fix), runs the regression tests,
backs up the previous files, and restarts the existing service with rollback on
startup failure. It does not replace `server.mjs`, credentials, flags, settings,
position journals or unrelated strategy files.

The account owner performs activation. Restarting the currently enabled LIVE
service can cause an already verified manual holding to enter existing exit
management, including exchange protection orders or a sale if current rules
trigger, and new automatic entries can resume after readiness checks pass.
Verify the current account and protection statuses in the application afterward;
an installer success message is not proof that every account check has passed.
