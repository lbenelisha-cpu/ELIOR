# Channel Take Profit (V2)

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
