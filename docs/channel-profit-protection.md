# Channel Take Profit (V2)

## Binance settings override (2026-11-05)

Binance managed LONG exits now use `SETTINGS_V1`: all four menu settings
apply to existing positions (including BNB) and new fills. The TP is
`actual entry * (1 + takeProfitPct / 100)`. Activation and initial SL also
use actual entry; the trailing gap is percentage points of entry below the
high-water mark. Already-earned stronger stops are retained.

The live server reapplies current menu settings when reconstructing managed
positions; LIVE fill reconstruction and DEMO fills persist this source.
Frozen channel geometry remains a reference for analysis and entry checks,
and cannot override Binance TP or activation. Colmex and historical unmarked
policy calculations below retain their existing channel behavior.

The frontend alone does not activate this change. Owner-run deployment of the
reviewed server commit is required (the existing
`scripts/install-binance-settings.sh <reviewed-full-commit-sha>` stages the
affected runtime files). The running server may then replace existing owned
Binance protection orders, including BNB's TP. Verify the new broker target
and stop after reconciliation; do not treat a settings save as broker approval.

The sections below describe the retained channel policy and Colmex behavior.

Binance Futures SHORT now mirrors these settings: TP = entry times
`(1 - takeProfitPct / 100)`, activation = entry times
`(1 - profitActivationPct / 100)`, initial stop = entry times
`(1 + stopLossPct / 100)`, and an armed stop follows the lowest observed Ask
plus `entry * trailingGapPp / 100`. Saved and verified tighter stops are
retained. New fills use actual execution and existing owned positions use
current settings on management. A channel target remains signal geometry,
not the exit override. POC uses the same settings calculation. SHORT TP must
be below 100%; entry and settings updates enforce this where applicable.
The SHORT runtime files must also be installed by the owner; the LONG settings
installer alone does not deploy `lib/futures-short-policy.mjs` and
`lib/futures-short-runner.mjs`. Deployment can replace live SHORT protection
orders and is not performed by this change.

New `channel_breakout` entries automatically freeze a `CHANNEL_TAKE_PROFIT_V2`
plan from the confirmed pre-breakout channel. The absolute Take Profit is:

`breakout boundary + full channel width`

The actual fill changes only the percentage return to that target. It never
moves the absolute target. The configured stop-loss, profit activation percentage
and trailing gap remain settings; there is no half-distance activation in V2.
A channel target below the configured activation is valid: Take Profit can close
first, before trailing is armed. The stored raw settings remain valid even when
an individual target is less than 0.1% above the fill.

Both Binance and Colmex channel entries use the exact configured stop percentage.
Risk-budget sizing remains in force. Other Colmex routes/older positions retain
the existing frozen volatility risk. Already-earned stronger protection is never
lowered. Current settings can still change stop/activation/gap on managed trades,
while the V2 channel target remains frozen.

Final submission reconstructs the signal, target and fixed settings. A target
already reached at the final executable price blocks entry. If a Binance market
fill nevertheless slips past the target, the frozen target is retained and the
normal exit evaluator reports Take Profit immediately; it does not silently
substitute the distant configured target.

Binance native protection uses the absolute target. Colmex submits an absolute
Take Profit bracket (rounded to the instrument tick), and reconciliation retains
that target from the confirmed fill onward. Stop-only Binance broker mode still
relies on the running server for Take Profit, as before.

Existing `CHANNEL_HALF_TARGET_V1` positions retain their recorded half-distance
activation and configured Take Profit. Manual/other strategy positions are not
silently migrated. Legacy settings fields are preserved for compatibility but
are no longer offered as a switch for new V2 entries. The fixed Take Profit input
continues to apply to non-V2 positions.

Deployment: Netlify publishes the Colmex runtime/frontend. Binance requires the
pinned `scripts/install-channel-primary.sh <commit> --install-only` on the VPS.
That installation preserves activation flags and current settings but changes
future channel entries to V2; it does not change the policy of saved positions.
Do not equate published frontend text with an upgraded Binance server.

Validation includes both final submission paths, real-fill reconstruction,
Binance native brackets, legacy replay, sub-0.1% targets, current configured
Colmex stops, and malformed/consumed/stale/changed signal rejection. No live
orders are used for testing.
