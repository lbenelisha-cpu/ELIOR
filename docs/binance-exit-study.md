# Binance Wyckoff chart history and exit study — 17 October 2026

The chart scans the available closed 5m source candles at each historical close using the shared Wyckoff rules, including while a position is held. It supplements reconstruction with recorded confirmed decision/fill setups and the actual current trade setup. Structural peak/first-low/secondary-test identity deduplicates repeated checks and subsequent lower Springs. Numbered badges refer to distinct structures visible in the chosen chart range, not trade executions. Clicking a badge selects its six phase labels and full prices/timestamps. Reconstruction is display-only, runs in a module worker, and is cached until the last closed candle changes. Other chart intervals still use 5m analysis. Incomplete histories are labeled rather than bridged with invented bars.

## Exit comparison

`reports/binance-exit-study-20261017.html` is a frozen interactive report with 41 real filled BUY entries from 11–16 October, downloaded through the read-only dashboard proxy. It compares nine exit variants over a common 24h horizon per entry using continuous closed 5m candles. All entries have complete coverage. Entries and quote amounts stay fixed; these independent counterfactual trade outcomes are not an executable portfolio return. Early exits would change cash availability and the eligibility of later entries; that is not simulated. Existing actual sell actions are not imposed on the alternative paths. The existing seven-day rule is applied counterfactually to every entry, including entries originally traded under older policies; its seven-day final outcome cannot be inferred from this 24h comparison.

The initial stop is 10% from the actual entry. Running peaks use closes only, signals use observed bars only, and fills use the following open less 0.05%. The entry bar is excluded because its pre-entry wick cannot be attributed to the position. Fees are modeled at 0.1% per side, not claimed as actual account commissions. Fixed-horizon marks also include estimated liquidation costs. A 10% stop observed only at a close can be exceeded before the next fill; this is not the live one-second monitor. Highest closes across the full 24h path are explicitly hindsight references, never signal inputs.

The strongest sample result, 80% gain retention without minimum hold, is +2.1026 USDT across 41 entries (+0.1795% mean net per entry), with 38 rule exits and only 11 positive outcomes. It is +0.2669 USDT over the first 27 entries and +1.8357 over the subsequent 14. This chronological split is not a blind holdout: all variants were considered retrospectively on one shared period. With 0.2% fee per side and 0.2% exit slippage, the same rule becomes −1.9908 USDT. There is no basis here to claim a statistically established edge or to enable a new live exit policy.

Reproduce with the original read-only action-log JSON (`live` fills) and one 5m chart JSON per symbol in a candle directory:

```
node scripts/binance-exit-study.mjs journal.json candle-directory output.html
```

The builder refuses incomplete cohorts instead of silently dropping trades. The committed HTML supplies the report layout. No API credentials, order IDs, raw action logs, or broker controls are embedded in the report. Source snapshots are not committed. Backend trading logic and deployment files remain unchanged.

Validation: 337 repository tests, including causal next-open fills, invariance to later prices, minimum hold/stop behavior, missing coverage, repeated structures, unfinished candles, and confirmed setup preservation. DOM checks render actual UNI data, click numbered history, retain active chart annotations, and exercise all report selectors. No visual browser screenshot was available.
