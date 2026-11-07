# Channel + fixed range POC entry (2026-11-07)

`CHANNEL_POC_RETEST_V2` implements the owner's four approved technical checks. Original numbers are retained in the UI:

| Check | LONG | SHORT |
| --- | --- | --- |
| 1 | Confirmed 50-candle swing channel, at least two touches per boundary | Same |
| 3 | Upper breakout prepares the candidate | Lower breakout prepares the candidate |
| 4 | Freeze volume profile from the lowest channel low to the completed breakout candle; enter on a subsequent downward return to POC | Mirror from the highest channel high to the completed breakdown candle; enter on an upward return to POC |
| 8 | Consolidation containing the channel's first anchor, lower or middle zone | Initial upper or middle consolidation |

Checks 2, 5, 6, 7, 9 and 10 are removed: no regression direction, volume multiplier, dollar-volume floor, consumed-channel filter, consolidation-exit requirement or target-reached entry gate. Regression remains a display layer. Consolidation retains the existing numerical definition (3–8 candles, range at most 35% of channel width, close drift at most 50% of range, zone thirds); only its required location in time changes. Missing candles/quotes and invalid data remain execution prerequisites.

The breakout candle's high/low can extend beyond the channel. Its final range and volume are known only when it closes, so B is frozen on that close. A later current quote must reach POC from the appropriate side, with the previous close still outside POC. A gap that crosses POC qualifies; there is no new proximity or spread rule in the technical strategy. Existing broker spread/fill checks remain in their execution paths. A later return can use the same channel; durable receipts prevent submitting the same return event twice.

The latest unambiguous channel breakout supplies the model; an opposite or two-sided breakout clears the opposite candidate. Models are reconstructed deterministically from available candle history, without future candles. If the source no longer contains the necessary pre-breakout evidence, the model becomes unavailable rather than silently estimating a replacement. Model A/B, bins, POC, frozen channel and initial consolidation are included in scan reports and in the eventual order setup. Existing trade journals, ownership checks, partial-fill protection and exit settings are retained.

## Volume calculation and display

The shared calculator freezes the profile over the wave from A through B: LONG uses the latest pullback low through the breakout high; SHORT mirrors this from the latest pullback high through the breakdown low. It allocates each 5-minute candle's volume across its high–low range into 128 bins and calculates the POC as the volume-weighted price inside the maximum-volume bin (ties select the lowest price). This reduces bin-rounding error and improves on the old 32-bin midpoint, but it remains an **OHLC estimate**, not exact trade-by-trade volume-at-price; the feed does not contain tick-level trades. Return candles do not extend B or alter the frozen histogram. Missing/zero volume cannot produce a POC. Binance LONG/SHORT and Colmex LONG/SHORT use this same shared calculation.

Both apps display the exact report model by default. Manual range selection remains display-only. Binance SHORT opens a separate read-only chart from the Futures report's own candles, never over Spot candles. Old or unavailable reports are labelled; chart output does not authorize orders.

## TradingView

`tradingview/levi-channels.pine` combines the swing channel, estimated fixed profile/POC and optional regression. Update the saved layout once using `tradingview-channels.html`. The link can choose the symbol and 5-minute interval, but cannot install an indicator into a TradingView account. TradingView recomputes from its own feed, sessions and visible history; the app's saved execution model remains authoritative. Keep Spot and Futures (.P) identities separate.

## Delivery

Colmex and the frontend deploy from the repository. The separate Binance VPS uses `scripts/install-channel-poc.sh FULL_REVIEWED_SHA`. The installer stages exact known policy variants (including the published Binance-only intrabar layout), validates all patches before writing, runs entry/execution tests on the staged installed runtime, backs up affected code, preserves local server/exit integrations, and verifies policy/activation/exit settings after restart. Unrecognized layouts abort without changing the running service. A failed post-install verification restores code only; exchange state and journals are never rolled back.

Offline tests cover the four gates, mirrored entry, fixed profile volume conservation, no breakout-bar purchase, initial rather than late consolidation, missing/stale data, changed final evidence, duplicate receipts, exact rendered POC, historical installer layouts, native protection, partial fills, settings changes, and Colmex final submission guards. They place no real orders.

### VPS selector compatibility (2026-11-07)

The first installer rejected `short-entry-prefix` on a deployed module whose `shortConfig` also returned `entryMode`, selected by `BINANCE_FUTURES_SHORT_STRATEGY`. The exact source provided from the VPS is retained as a test fixture. The installer now recognizes that reviewed prefix and preserves its `POC_AUTO`/`CHANNEL` selector byte-for-byte while replacing the channel evaluator. Both original layouts remain supported. Unknown guards, edited selectors and mixed prefixes still abort before any staged files are written. Post-restart verification checks that the reported SHORT mode is unchanged in addition to activation flags and exit settings. This compatibility fix does not change live environment values or replace local runner integrations.

## Checklist display during candle rollover (2026-11-07)

Binance and Colmex retain the last validated checklist during brief quote/history/candle waits, labelled as the previous scan with its original timestamp. This includes POC waits that have no condition report and a panel first opened immediately after a candle boundary. A delayed envelope cannot renew the report's candle expiry. The retained view has zero current approvals, never authorizes execution, and expires after the existing 90-second LONG / 180-second SHORT evidence lifetime. Invalid data, a new failed condition, loss of transport, a different market/symbol or manual/historical chart context cannot inherit current approvals. No entry, data-freshness, POC, order or protection rules change.
