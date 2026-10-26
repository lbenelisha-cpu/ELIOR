# Current entry policy: RSI40 without hourly trend confirmation

As authorized on 2026-10-26, automatic Binance and Colmex entries require the
existing 5m Wyckoff Spring structure with RSI(14) between 0 and 40, inclusive,
including the current open candle. Neither platform requires an hourly uptrend.
Colmex already operated without an hourly gate; its RSI maximum changes from 30
to 40. Binance removes the close > SMA20 > SMA50 requirement both during
evaluation and before automatic order submission.

Binance evaluation, final execution validation, closed-bar replay and public
configuration use BINANCE_ENTRY_RSI. Colmex live entry and closed-market
preparation use AUTO_POLICY.entryRsi. Browser charts highlight the 0–40 entry
range. The standard RSI screener's optional 0–30 preset remains a separate
display filter. The generic shared engine retains its default 30 for historical
callers; both production entry adapters explicitly select 40.

Fresh price and candle checks, full Wyckoff structure, pattern reuse limits,
post-sale boundaries, stablecoin exclusion on Binance, cash and position caps,
and existing exit/protection rules remain enforced. Binance's high-RSI Spring
reset now occurs above 40. No historical trade records or search boundaries are
rewritten. Policy versions invalidate stale Binance replay and Colmex
preparation caches. Closed-market preparation still cannot submit orders.

The hourly indicator module remains available for historical research. Its
mathematical tests do not describe the current production entry requirement.

## Deployment

Colmex server functions and both frontends deploy from main through Netlify.
Install the Binance backend from a tested, merged full commit SHA:

```bash
cd /opt/levi-binance
git fetch origin main
git show REVISION:scripts/install-binance-rsi40.sh > /tmp/levi-rsi40-install.sh
bash /tmp/levi-rsi40-install.sh REVISION
```

The installer stages and syntax-checks the five affected backend files, runs an
offline policy smoke check, backs up the replaced code, stops the service before
copying, then starts it and verifies the public GET /api/binance-mode response.
It restores code if startup or capability verification fails. Account data,
environment settings, pending intents, positions and trade journals are not
modified by the installer. It sends no test order; existing authorized automatic
operation resumes using the updated entry policy.

Validation covers RSI in the newly allowed 30–40 range, the inclusive boundary,
rejection above 40, caller override rejection, stale data and pattern reuse,
stablecoin rejection at submission, missing/downward hourly data, preparation
without execution, and the complete regression suite. Relaxing entry conditions
does not establish or promise higher returns.
