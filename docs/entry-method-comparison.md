# Entry-method comparison — 29 October 2026

`ENTRY_METHOD_COMPARISON_V1` is **simulation only** on Binance and Colmex.
It cannot submit an order or enable a trading route. The live V2 quality policy,
higher-second-recovery requirement, positions, protection settings, manual order
controls and account-review restrictions retain their execution behavior.

## The comparison

- `current`: the current closed-candle technical policy, including Wyckoff Spring
  and its early-wave alternative, both requiring the higher second recovery.
- `breakout`: close above the prior 20 highs, volume at least 1.5 times the prior
  20-bar mean, mean dollar volume at least 10,000 per bar, and the same MA100/200
  downtrend veto. No Spring, recovery pair or RSI ceiling is required.

These thresholds are registered experiment parameters, not research-proven
optimal values. No tuning or automatic winner selection is performed.

Both methods see the same 5-minute closed bars. A signal can only fill at the next
available bar's open. Signals expire before an overnight stock-market opening.
Incomplete bars, duplicate timestamps, invalid OHLC, unexpected gaps and missing
volume cannot silently create valid entries. Stocks use regular-session candles.

## What the results mean

This is an **equal-risk trade study, not a portfolio backtest**. Each simulated
trade risks 1 R at its initial percentage stop; quantities are mathematical and
do not impose broker minimums, portfolio slot limits, cash, or integer shares.
There is at most one open simulated trade per method per symbol. Both methods
use the same frozen Settings percentages (stop, profit activation, trailing gap,
and target). Colmex live ATR-based sizing is deliberately not used by either
method in this isolated entry comparison. Actual live readiness is recorded in
a separate diagnostic column and never substituted for simulation readiness.

The model uses the real trailing-level function, a non-decreasing stop, adverse
open gaps, two possible intrabar OHLC paths, and the lower marked liquidation
value of those paths. Ambiguous trades are counted. This does not reconstruct
ticks or guarantee a worst case across every possible tick path. Exit times are
the close of the candle containing the modelled exit, not exact tick timestamps.

Each side of a trade includes explicit assumed costs, in basis points:

| Platform | Fee | Half spread | Slippage |
| --- | ---: | ---: | ---: |
| Binance | 10 | 5 | 5 |
| Colmex | 15 | 10 | 10 |

These are scenario assumptions, not verified account charges. The local replay
tool accepts alternative costs for stress testing. Net R, mean net R, win rate,
profit factor and drawdown of the **closed-trade R sequence** are shown. Open and
incomplete trades are listed separately. This drawdown is not portfolio equity
drawdown. The UI does not claim real net profit, Sharpe or statistical significance.

Settings/cost changes create distinct cohorts; existing simulated positions keep
their original exits. There are at most 6 cohorts, 150 symbols per cohort and
1,000 retained closed trades per cohort. Pruning and capacity errors are visible.
The 14/7/7-day chronological windows are anchored at collection start. Trades
crossing a phase boundary are excluded from phase tables. Whole-cohort tables
retain them. These descriptive windows do not replace a full out-of-sample study
with multiple-testing control and a longer sample.

## Collection and execution isolation

Binance uses a paced background read of the existing candle cache, separate from
exit execution. It includes held symbols and symbols with open simulated trades.
Colmex reuses scanner and closed-session preparation histories. Full accounts
and bracket-permission blocks can still scan for observation; they cannot submit
entries. Position protection remains first priority. Broker outages, risk-data
errors, time budgets or write reconciliation can interrupt observation; gaps are
reported, never backfilled as known profits.

No trades before the first symbol observation are fabricated. Later unprocessed
candles are replayed causally. This ignores actual scanner latency, so it is not
evidence that the live scanner could have filled every modelled signal. Actual
account, capital, data, market-hours and strategy blockers remain distinct.

## Offline replay

`node scripts/compare-entry-methods.mjs /path/to/candles.json`

Input is `{platform, startAt, endAt, settings, costs, markets:[{symbol,bars}]}`.
Dates are ISO timestamps. Each bar needs numeric `openTime`, `closeTime`, `open`,
`high`, `low`, `close`, `volume`, and `closed:true`. Include at least 204 warm-up
bars before `startAt` and preserve missing-data gaps. Inputs must be available
at the simulated decision time; a hand-selected winner is not a market study.
The tool reads only the supplied file and prints a JSON report. It never calls
account or order endpoints. A single-symbol replay is a diagnostic example,
not proof of profitability or permission to activate a new live strategy.

## Deployment

Netlify deploys Colmex and both interfaces. The separate Binance VPS needs the
reviewed installer revision. The installer verifies the simulation policy and
continues to verify the V2 recovery rule and Settings-only Binance stop policy.
The UI is under “מעקב שיטת הכניסה · תוצאות והשוואה” →
“וואיקוף מול פריצה עצמאית · סימולציית עסקאות”.
