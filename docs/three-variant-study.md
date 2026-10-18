# Three Wyckoff variants — fixed protocol, 18 October 2026

This is an isolated research portfolio, not actual account performance and not a
change to live entry/exit policy. The primary variants are the existing seven-day
profit hold, the same rules with hourly trend confirmation, and the same Wyckoff
entry with ATR/structure exits. The combined version is an additional ablation.
All rules are recorded in `research/three-variants-20261018-plan.json` before
calculating variant outcomes. No parameter search is performed.

## Reproduce

```
python scripts/download-three-variant-data.py research/three-variants-20261018-plan.json /tmp/three-variant-data END_TIME_MS
node scripts/build-three-variant-study.mjs research/three-variants-20261018-plan.json /tmp/three-variant-data /tmp/three-variant-results.json
node scripts/render-three-variant-study.mjs /tmp/three-variant-results.json reports/binance-three-variants-20261018.html
```

Use the exact end timestamp in the committed data manifest to reproduce the same
window. Public data comes from Binance's public market-data endpoint. Each of 16
symbols must have all 19,296 continuous closed 5m candles (67 days). Seven days
provide warmup; 60 days form the full study. The downloader fails on incomplete
coverage and hashes each source file. The builder uses the existing shared
Wyckoff detector on rolling seven-day histories and considers only data available
at each historical close. Signals are not retroactively placed at the Spring low.

Source snapshots and per-symbol detection caches are local intermediate files,
not included in the public report. The data manifest, fixed rules, reproducible
scripts and frozen results in the report retain provenance without API keys or
account order identifiers.

## Execution and evaluation

The portfolio starts at 143.62915 USDT with five fixed initial-capital allocations;
entry budgets include modeled entry fees. Sale cash is immediately available for
new entries. The last free slot may spend the available remainder if its order
exceeds 5 USDT. No borrowing and no multiple simultaneous positions in a symbol.
Simultaneous candidates use alphabetical tie breaking, independent of outcomes.
A used pattern cannot be used again, and the underlying new signal time must be
after the last sale. Trend confirmation uses the last completed UTC hour, never
an unfinished hourly candle.

Decisions at a closed 5m bar execute at the next open with adverse slippage.
Peaks and exit signals use observed closes, not hindsight maxima. Initial and
trailing stops can therefore be exceeded before execution. This is not a
one-second live replay. The current model mirrors the seven-day profit hold:
loss protection remains active throughout, and after seven days 80% retention
applies only if a gain has actually been observed. The alternative starts at
2.5 ATR14 (capped at 10%), ratchets at peak minus 3 ATR, and exits on two
consecutive breakdown closes after at least one initial risk of favorable move.

All outcomes include estimated liquidation cost at the end. `END_MARK` is a
mark of an otherwise open position, not a strategy sale; it does not increment
sellCount or the closed-trade win rate. Drawdown uses every closed 5m mark.
The displayed equity curve is downsampled every four hours. CSV contains every
modeled trade in the selected variant and period.

The first 40 days and last 20 days run as separate portfolios with historical
warmup. The later window is historical and has not been used to change the
parameters, but it is not a prospective unseen trial. A separate later-window
stress run uses 0.2% fees and 0.2% slippage on each side, versus 0.1% and 0.05%
respectively in the base case.

The fixed universe combines major coins and account-discussed assets. It is not
the historical Binance universe or live volume rank, so selection/survivorship
bias remains. Historical depth, spread, lot rounding, delisting and intrabar live
confirmation are not reconstructed. The 5-USDT minimum is a model assumption,
not each symbol's historical exchange filter. These limitations preclude claiming
a proven profitable strategy, even if one fixed sample is positive.

Validation includes capital constraints, next-open causality, unchanged earlier
exits when future prices change, initial loss protection during profit hold,
no invented breakeven stop without gains, hourly close timing, ATR ratchets,
structure breakdowns, cost sensitivity, and fresh re-entry signals.

## Frozen result

Full 60-day net returns (base costs): current +18.94%, trend +35.90%,
ATR/structure -20.10%, combined -0.52%. These positive full-period numbers
for the first two versions do not survive the later-period comparison.

In separately restarted last-20-day portfolios, all lose: current -11.80%
(19 buys, 14 strategy sells, 5 end marks), trend -17.99% (13/11/2),
ATR/structure -10.09% (161/160/1), combined -2.64% (35/35/0).
Initial capital is 143.62915 USDT. Corresponding net USDT outcomes are
-16.9526, -25.8412, -14.4959, -3.7921 (see frozen JSON for exact values).
Last-20-day base modeled fees are 1.028, 0.695, 9.163 and 2.007 USDT.
The ATR exit's much higher turnover materially increases trading costs.

With higher fees/slippage the last-20-day returns fall to -13.51%, -19.06%,
-25.73%, -5.98%. The combined version loses least in this small recent sample;
that is not evidence of a profitable edge. No live policy is changed. Any next
step should be a prospective paper evaluation of fixed rules rather than
selecting the strongest full-period result and deploying it.

All 374 repository tests pass. Rendered report JavaScript was exercised for
all four period views; all table/curve views render, source checksums match,
trade P&L sums reconcile to portfolio cash, and buys equal strategy sells plus
end marks. No live orders were submitted during verification.
