# Research-based monitoring, 27 October 2026

Scope: Binance and Colmex. This release implements observation and evaluation, with no change to entry/exit conditions, position size, trading permissions, or accounts. It adds no market-data requests and uses the existing scan cadence. It does not integrate Walt or replace the execution venue.

## Evidence and implementation

The source registry is `lib/trading-research-sources.mjs`; the same 11 links and limitations are visible in both applications. This is a selected review, not a claim to cover all trading literature. Author/institution abstracts, original datasets, available paper text and official technical documentation were consulted. Full-text retrieval of some papers was unavailable; abstract-only sources are labelled. No paper establishes profitability of our five-minute Wyckoff or early-wave parameters.

| Source / method | Implementation | Boundary |
| --- | --- | --- |
| Lo, Mamaysky & Wang (NBER w7613) | Measurable pattern identities and forward outcome records | Statistical pattern recognition is not a validation of our Wyckoff rules |
| Moskowitz, Ooi & Pedersen (AQR original data) | Closed-bar momentum at 12 and 48 bars; UP / DOWN / MIXED context | Original evidence concerns multi-month futures strategies, not our intraday windows |
| Moreira & Muir (NBER w22208) | Volatility context alongside the existing risk-sizing implementation | Does not identify an optimal stop or prove our sizing policy |
| Fidelity ATR and ATRP | Wilder ATR14 divided by last closed price | Volatility, not direction; no new entry restriction |
| Bailey et al. (PBO) and Harvey et al. (multiple testing) | Fixed version, all five registered variants, explicit exploratory status | No PBO/DSR/p-values without the full trials and suitable return matrix |
| scikit-learn TimeSeriesSplit | Frozen calendar phases and temporal exclusion around boundaries | Time-based adaptation for irregular events; not a fitted ML model |
| Politis & Romano stationary bootstrap | Resampling whole UTC-day clusters in geometrically restarted blocks | Exploratory uncertainty; not a selection-adjusted significance test |
| Binance execution documentation / FINRA order guidance | Verified net trade metrics, separate hypothetical cost stress | A candle is not a fill; stops do not guarantee a loss cap |

## Causal measurement

Snapshot features use at most 205 completed five-minute candles available at observation time. Future/open bars are excluded. Require 49 valid ordered OHLC bars; reject duplicate, malformed, stale or missing intraday bars. Binance must be continuous; only calendar-verified stock session gaps are accepted. The 12/48-bar changes describe trading bars, not continuous clock hours for stocks.

Additional descriptive measures: last closed volume divided by the previous 20-bar mean; a rolling 20-bar typical-price volume-weighted proxy (not tick VWAP); absolute 20-bar net movement divided by the sum of absolute close changes (efficiency ratio). Missing/zero-denominator volume yields null. These features are hypotheses to assess, not independent proven trading advantages.

Regime is frozen at signal time: UP when 12-bar return exceeds ATR percentage and 48-bar return is positive; DOWN is the symmetric negative condition; otherwise MIXED. Invalid history gives UNKNOWN. This rule, the horizons and all bootstrap parameters are application choices, not values derived or optimized from the cited studies.

Each accepted comparison variant retains its own pattern ID and policy version. Context is persisted in the pending observation and survives restarts. Legacy pending rows without context continue contributing to the old aggregate but are never backfilled into the new research sample. The endpoint is the first available valid closed price 30–35 minutes later. Missing continuation expires under the existing 45-minute rule.

Path excursions include only closed prices after the observation, plus zero at the observed starting price. They require every expected five-minute close through the endpoint; otherwise both excursions remain null. They are not intrabar MFE/MAE, executable stop paths or trade profits.

## Evaluation protocol

`TRADING_RESEARCH_V1` is observation-only. A start time is persisted at the first eligible collection call. The initial 14 calendar days, next 7 days, next 7 days, and subsequent continuation have separate summaries. An outcome crossing a boundary is excluded from those summaries, as is an observation starting within 35 minutes after a boundary. The boundaries never slide to improve results. No method is selected by this code and no parameter fitting occurs; these are prespecified forward monitoring windows, not a claim of completed walk-forward optimization. The existing daily research engine has separate chronological selection/test periods.

At least 100 retained observations over 30 observed UTC dates are required before an uncertainty interval is shown. Whole-day clusters retain all symbols and signal overlap within a day. A stationary bootstrap uses expected block length 5 observed dates, 400 replicates, a deterministic seed, and the 2.5/97.5 percentiles of the pooled observation mean. This is an approximate exploratory interval. It relies on temporal stability, does not adjust for multiple testing, and is not a probability of future profit. It is not a Sharpe ratio; 30 days is a reporting floor, not proof of adequate statistical power. Multiple variants share underlying signals and are not independent experiments.

Cost stress subtracts assumed total round-trip costs of 10/30/60 basis points (0.10/0.30/0.60 percentage points) from the observed price change. It does not use or estimate account fees, market impact, borrow/funding costs, actual executions or exit paths. Labels always distinguish these scenarios from real verified net P&L. Real trade groups add arithmetic mean net P&L per closed trade and total positive net / absolute total negative net; any missing net accounting suppresses these metrics, and a zero loss denominator gives null, not infinity.

## Coverage, retention and operational limits

The research store retains up to 2,000 variant-outcomes, prunes records older than 90 days relative to the latest resolved outcome, and reports how many were removed. Summaries describe the retained window, not all history. The existing forward counters remain lifetime aggregates. No raw price/size/credential/account payload is added to public status.

Collection is conditional on the existing scan and free-position paths. Occupied slots, held symbols, quote/history outages, broker limits and closed stock sessions can reduce coverage. This is an observed-signal cohort, not a full-market census or unbiased estimate of all possible entries. Existing missing/dropped counters and path completeness are visible. There is no automatic winner, deployment trigger or promise of profit.

Not implemented as trading rules: order-book imbalance, sentiment/news or LLM trade decisions, cointegration/pairs, portfolio covariance optimization, adaptive leverage, or automated parameter search. They require data and evaluation not present in this release. Accurate equity curves with verified fees, executable bid/ask replay, complete scan coverage, corporate-action-adjusted stocks and an untouched external historical dataset are prerequisites for stronger performance claims. The code does not suggest otherwise.

## Deployment and verification

Netlify updates Colmex runtime and both frontends. Binance's VM separately needs the reviewed commit installed with `scripts/install-confirmed-quality.sh FULL_SHA`. The installer now also verifies `researchMonitoring.version === TRADING_RESEARCH_V1`; an unchanged entry-policy version cannot falsely certify the research update. It retains the existing code backup and rollback procedure.

Tests cover causal features, timestamp normalization, stock calendar gaps, missing/invalid input, frozen phase boundaries, persistence/deduplication, incomplete paths, day-cluster intervals, bounded retention, missing commissions, UI provenance and unknown-backend states, and unchanged live entry decisions. No live order is used to test research.
