# Higher second recovery — 29 October 2026

The active five-minute Binance and Colmex entry policy is CONFIRMED_QUALITY_V2.
Its recovery rule is SECOND_RECOVERY_HIGHER_V1. Both Spring/reclaim and early-wave
automatic entries require it. Manual orders and exits of existing positions do
not acquire this entry filter. Stop percentages remain unchanged, including the
Binance SETTINGS_ONLY_V1 update.

First recovery = the saved rallyHigh following the first low. Second recovery =
the first upswing following the saved secondaryTest and before Spring. Compare
absolute wick highs, strictly second > first; equality is rejected. A subsequent
closed candle must confirm the second peak by closing below the previous close
without setting a higher high. An open candle is never sufficient. The first
confirmed second peak is frozen: a later third recovery does not repair it. A
Spring candle cannot set its own preceding recovery high when OHLC cannot reveal
which intrabar extreme happened first.

The rolling scanner retains a second recovery within its original structure,
while normal setup/confirmation expiry and initial-peak invalidation remain.
An early-wave breakout uses only recovery evidence already confirmed before its
breakout candle. Final submission revalidates the saved prices and chronology,
so old V1 signals lacking evidence cannot pass the new quality assertion.

The shared structural evaluator retains an explicit legacy comparison mode for
historical studies. Production quality evaluation and current chart analysis
enable requireHigherRecovery. Reconstructed chart patterns without a qualifying
second recovery are not labelled as confirmed. Actual historical trade records
remain historical facts and are not rewritten to pretend the new rule existed.

Diagnostics preserve first/second price and time, second confirmation time,
percentage difference, pass/fail, and a readable reason. A qualifying comparison
is only one condition: volume, RSI (Spring route), trend, timing and account
guards still apply. This is the owner's custom entry rule, not a claim that every
classical Wyckoff setup must have this structure or that profitability improves.

## Read-only check of a past purchase

Run `node --env-file-if-exists=.env scripts/audit-wyckoff-recovery.mjs SOXSBUSDT`
from the VPS checkout. The script reads at most the last three matching BUY
records. If second-recovery metadata is absent, it requests public Binance 5m
candles only through the purchase time and verifies the original peak/RH/ST
identity before reporting a reconstruction. Missing or unmatched evidence stays
unknown. It never calls an authenticated account or trading endpoint.

The repository/Netlify release does not update the separate Binance VPS. Install
the reviewed commit with scripts/install-confirmed-quality.sh; its smoke check
verifies the recovery rule and preserves the Settings-only Binance stop policy.
