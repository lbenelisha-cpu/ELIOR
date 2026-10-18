# Wyckoff with hourly trend confirmation

Automatic Binance entries require the existing 5m Wyckoff confirmation plus:
last completed UTC hourly close > SMA20 of hourly closes > SMA50 of hourly
closes. SMA20 must strictly exceed SMA50. The module derives exactly 50
completed, continuous hours from 600 existing closed 5m candles. The unfinished
hour never affects approval. Missing, duplicate, malformed or stale required
bars produce WAIT_HOURLY_TREND_DATA rather than a trade approval.

The evaluation layer applies this gate to new DEMO/LIVE automatic entries;
existing positions bypass entry gating and retain their saved exit policy.
The actual automatic LIVE submission rechecks the current gate from the existing
candle cache/feed before creating any order intent. Fresh execution prices,
five LIVE slots, funding, fees reserve, signal expiry and fresh post-sale signal
requirements remain enforced. Manual buys remain explicit user-directed actions
and bypass the automatic Wyckoff/trend gates. Manual sells are unchanged.

No volume, depth, momentum-strength, RSI or ATR entry/exit filters are enabled
by this change. The existing loss stop, profit retention, and profit-hold rules
are unchanged. This implements only the trend-entry variant in the frozen
60-day research comparison, not the ATR or combined alternatives. Historical
5m study confirmations still differ from live intrabar confirmation timing.
The last-20-day research result for this variant was negative (-17.99%);
the update does not establish or promise profitability.

Agent diagnostics retain the underlying Wyckoff analysis signal separately from
the final entry approval. UI displays the hourly close, SMA20, SMA50 and exact
hour-close time. The UI indicates pending server installation when connected
to an older backend rather than claiming the gate is already active. Read-only
market-watch replay and technical history use the same quality gate. Policy V5
separates new Kelly learning cohorts and resets stale market-watch replay labels.
Existing fills and their historical rules remain untouched.

## Deployment

From the existing Ubuntu server terminal:

```
cd /opt/levi-binance &&
git fetch origin &&
git show REVISION:scripts/install-binance-hourly-trend.sh > /tmp/levi-hourly-trend-install.sh &&
bash /tmp/levi-hourly-trend-install.sh REVISION
```

The pinned installer stages and syntax-checks the server plus dependencies,
backs up the old server/lib, restarts the service and checks the read-only
/api/binance-mode capability for the 20/50 filter. It restores the backup if
startup or capability verification fails. It sends no manual trade order;
normal authorized automatic operation resumes with the installed policy.

Validation: all 379 tests pass, including strict averages, exclusion of partial
and future hours, stale/missing/duplicate data, automatic pre-submit rejection,
manual-action compatibility and preserved post-sale requirements. Live gate
values also match the frozen simulation at 136 historical BTC observations.
No real orders were submitted during verification. SSH from the coding workspace
is unavailable; server installation must be run in the owner's SSH terminal.
