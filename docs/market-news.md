# Market news channel

`/market-news.html` is a Hebrew RTL news reader linked from Binance, Colmex and
manual research. It reads the public `/api/market-news` snapshot on the existing
Binance VPS. Deploying the static website alone does not install the collector.
No API key, paid subscription, LLM, new broker permission or scheduled Netlify
function is needed for this initial version.

## Collection and coverage

The server polls four fixed public RSS URLs every five minutes: CoinDesk,
Cointelegraph, and PR Newswire finance and technology. See `NEWS_SOURCES` for exact
URLs. Official feed discovery: https://www.coindesk.com/coindesk-news/2021/09/17/coindesk-rss,
https://cointelegraph.com (RSS link), https://www.prnewswire.com/rss/.
Availability can vary by host/network. A failed source is explicitly unavailable,
with exponential backoff capped at one hour. Page refreshes do not trigger feeds.

Only headlines, source links, publication/first-seen times and derived tags are
retained, at most 600 articles from the past seven days. Feed coverage is finite:
polling can miss articles; this is not all internet news, all rising assets, or a
real-time institutional holdings service. Public RSS availability is not a promise
of a permanent commercial data licence. Reassess provider terms/paid feeds before
expanding distribution. No social media, SEC 13F, paid vendor or full article
republishing is included. No claim that a headline proves an investment occurred.

URLs and hosts are fixed, redirects rejected, bodies capped at 2 MB, each request
timed out at eight seconds, and concurrency limited to two. RSS with DTD/entities,
malformed feeds, unsafe/cross-host links, future dates and undated items is rejected.
HTML is stripped and UI text uses textContent. RSS content never becomes executable
instructions or configuration. API is GET-only and contains public news, not
accounts, credentials, holdings or user search queries.

Atomic state is stored at `/var/data/market-news.json` (`MARKET_NEWS_FILE` can set a
server-side path). First-seen times survive restart. Revised titles/dates are
display-only; repeated URLs are deduplicated across categories. Duplicate titles
do not add corroboration, and retained older reports with the same event identity
prevent republished events from becoming fresh. Missing/corrupt state starts a new
baseline so pre-start reports cannot affect entries. Save failure disables news
influence until storage recovers; it does not stop position exits.

## Decision integration

Default: collection and observation only. Enable explicitly with BOTH:

```
MARKET_NEWS_ENTRY_OVERLAY=true
MARKET_NEWS_ENTRY_AFTER=<UTC activation timestamp>
```

This is an entry overlay for Binance automatic crypto entries only. It cannot
create an entry, bypass technical confirmation, account reconciliation, native
protection, cash/slot limits or risk sizing. It never causes sales. Manual orders
and Colmex remain on their existing execution paths. Stock/company reports are
visible but do not change equity or bStock decisions in this version.

The extractor deliberately recognizes a small set of explicit completed crypto
purchases by named companies (actor + identical quantity + asset) and explicit
Ethereum/Solana/Bitcoin network outages. Other investments, price rises, ambiguous
tickers, multiple crypto assets, future plans, negations and rumors are display-only.
Explicit bStock membership maps to stock identity, never by a guessed B suffix.

Influence requires matching event details in two distinct editorial publisher
groups, within 30 minutes of each other, both first seen within 30 minutes of
publication, after activation and initial collection baseline. Identical headlines,
press releases, detected attribution/syndication and revised stories cannot add
corroboration. Matching titles are NOT independent verification; this conservative
rule can still misclassify or miss events. General sentiment is not a truth score.

Fresh corroborated purchases sort already-qualified candidates ahead of other
qualified candidates. Fresh corroborated outages veto new automatic entries.
Negative matches take precedence. Evidence expires after one hour; source health
and snapshot age must be within 15 minutes. News is rechecked after the final
candle read and immediately before submitting the order intent. Decision history,
agent state and buy journal metadata preserve reasons and supporting source IDs.

If news is missing/stale there is no news priority or veto; base strategies continue
under their existing checks. This is NOT an all-clear signal. The news page clearly
distinguishes observation, configured influence, current event influence and actual
LIVE execution permission. An enabled overlay does not guarantee trades or returns.

## Owner installation

Use the reviewed full merged commit SHA. The installer stages/syntax-checks code,
runs offline tests, backs up installed code and its own service override, restarts
the existing service and verifies the API. It preserves credentials, journals,
existing independent-entry permission and exit settings. Restart can resume the
existing bot under its already-enabled live settings. No exchange calls occur in
the tests; live account/protection readiness still needs checking after installation.

```bash
cd /opt/levi-binance &&
git fetch origin main &&
news_revision=<reviewed-full-commit-sha> &&
git show "$news_revision:scripts/install-binance-market-news.sh" > /tmp/install-binance-market-news.sh &&
bash /tmp/install-binance-market-news.sh "$news_revision" --install-only
```

`--install-only` starts collection and preserves any existing news-overlay flag.
On a first installation it is observation-only. `--enable-entry-overlay` explicitly
enables news influence on real automatic entries with a fresh activation timestamp.
`--disable-entry-overlay` disables that influence while retaining collection.
Only `/etc/systemd/system/levi-binance.service.d/91-market-news.conf` is managed.
Rollback restores previous code and that override; it cannot undo real trades.

## Validation

`node --test tests/market-news*.test.mjs` covers source bounds, identity, ambiguous
mapping, event extraction, timestamps, stale/revised/syndicated reports, independent
groups, persistence, deduplication, backoff, storage failure and final buy gating.
The complete repository suite covers unchanged technical eligibility, sizing,
manual execution and exit protection. Installer tests use temporary directories,
stubbed systemd and status responses. No real order is sent during validation.
