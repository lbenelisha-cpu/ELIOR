# News and observers: attention only

### Entry checklists (2026-11-06)

Each shared watch card lists the LONG Spot and mapped SHORT Futures entry
requirements. A checkmark means the condition passed in the displayed server
check; a circle identifies the unmet gate; a dash means it has not been verified.
`channel-entry-checklist.js` displays `CHANNEL_CONDITIONS_PARALLEL_V1` reports
from the actual entry evaluators. Every computable condition is evaluated against
the same input snapshot, including conditions after the first rejection. Missing
prerequisites leave only dependent conditions unknown; malformed or stale input
cannot produce current approvals. The single `reason` retains its original
first-blocker meaning for existing logs, while `conditions.rows` contains the
independent results. Old servers retain the explicitly labelled legacy ordered
projection until the server update is installed. The UI never substitutes Spot
closed-bar observations for Futures quotes or accumulated open-candle volume.

LONG requires the advertised current channel/consolidation policy; SHORT uses
only the verified contract's read-only shared observation. Malformed reports, unknown legacy reasons,
unverified mappings and policies, future dates, transport/auth loss, expired
observations and the next five-minute candle clear current approvals. The 90-second LONG
and 180-second shared SHORT observation lifetimes are upper bounds. These are
timestamped scan results, not live quotes. New scans replace previous conditions;
an expired scan cannot approve a current entry.

Account permission, cash, capacity and protection approval remain a separate row:
a reported blocker is shown explicitly; no reported blocker remains unverified.
Even a complete technical checklist does not authorize an order. The UI uses the
existing response and adds no API requests. The frontend and Colmex functions deploy
through Netlify. Binance additionally requires `scripts/install-parallel-entry-checks.sh
<full SHA>` on the VPS. It stages an atomic targeted patch and runtime tests, backs
up the changed files, preserves local integrations, activation flags and exit
settings, and verifies both report capabilities after restart. No trading rule,
allocation, order route or exit protection is relaxed.

The installer also recognizes the exact Binance-only intrabar evaluator published
at `5381d2cc0db960c8faedef38eb9fb55e8c95b501`, followed by the targeted settings and
consolidation patches. It installs the independent report using the same strict
Binance candle-gap rules and original import layout, retaining the existing exit
code. Shared and Binance-only layouts are matched exactly; modified guards, mixed
or duplicated evaluators and unknown imports still abort before any writes.
The historical fixture is the original published module, not a generated approximation.

Historical installer reconstruction (including the earlier attention installer)
runs against the pristine release. Behavior tests run against the staged installed
modules, with the same complete suite also exercised by the Binance-only layout
fixture. The source-isolated exit-monitor test supplies the optional deployed
`refreshPocTrail` dependency; it still verifies idle cycles make no exchange
request and a triggered stop executes. This does not replace or validate the
local hook's implementation; the installer preserves it unchanged.


Data availability (the rolling 50 closed bars, fresh quote and current open bar)
is not a checklist row and does not count toward the ten technical conditions.
While the server awaits those inputs, or the recorded scan has expired, the
summary says it is waiting for updated data instead of dropping to a misleading
zero score. All server data validation and expiry checks remain in effect;
the UI does not treat an expired candle's checkmarks as current approvals.

During a short candle transition or quote/open-bar/history refresh, the display can retain
the last recorded checklist as **previous**, with a blue checkmark, its original
timestamp and “אושר בבדיקה הקודמת · מתעדכן”. The summary retains the prior count
labelled as such instead of implying that confirmed channel touches have failed.
A fresh failed touch check replaces that history immediately. Malformed or unknown
results, unavailable policies/mappings, transport/auth loss and asset removal clear
the history. It is isolated by asset, market and direction, bounded to 300 entries,
and never persisted. Repeated pending updates do not extend the original 90-second
LONG / 180-second SHORT lifetime. Current execution blockers are never inherited
from a previous scan. This presentation history is not consulted by any executor.

Binance Overview and Scans include an authenticated “איתותים ותצפיתנים” board. The existing agent response supplies it; the widget makes no requests or order submissions. A news report creates a watch highlight, never a buy/sell decision. The server ignores the legacy MARKET_NEWS_ENTRY_OVERLAY activation for execution. Automatic candidate ordering, final submission, POC, quantities and exits do not consult news.

### Hebrew headline briefs (2026-11-06)

The board and the shared news page display a short Hebrew translation of the
complete source headline, labeled as an automatic headline translation. This is
not a summary of an unread full article. The original headline and source link
remain visible. Longer translations have a three-line preview and an expand button.

The isolated browser helper `news-summary.js` sends only public headlines from
the existing three allowed publisher hosts to MyMemory's GET translation API
(`autodetect|he`, verified with the provider). It does not send symbols, account
state, credentials, source URLs or trading decisions. Requests omit credentials
and referrers. Nothing is added to the server's trading or news polling paths.

Translation starts when a story becomes visible, runs at most two requests at a
time, deduplicates the same headline and caches successful text for seven days
(at most 300 headlines). A changed headline is translated separately. The helper
caps input at the provider's 500 UTF-8 byte limit without truncating it, and
records a rolling 5,000-character budget per browser. Provider quotas can also be
shared by IP; a quota response pauses new translations for 24 hours. Storage
failure leaves the in-memory limits in effect for the current page. Unavailable
translation is explicitly labeled and never affects signals or execution.

Provider references: https://mymemory.translated.net/doc/spec.php and
https://mymemory.translated.net/doc/usagelimits.php . The HTML, scripts and styles
deploy through the existing Netlify site; no Binance service restart is needed.

The public news page supplies source links, headline metadata and watch signals for mapped companies and crypto. Explicit headline aliases/catalogued stock tokens are used; ambiguous or unmapped stories remain in the news feed. Sources are limited to the four configured RSS feeds. A blocked source remains unavailable (this update does not fix CoinDesk's HTTP 403 or grant API access). The system does not read or verify full articles. It checks feed structure, exact allowed HTTPS source, publication/first-seen times, explicit asset references, duplicates, revisions, uncertainty and attributed material. The historical narrow event matcher is used solely to label matching purchase/outage headlines from two distinct publishers; it cannot influence execution. Identical or syndicated/uncertain/revised reports do not corroborate an event.

Fresh reports (up to six hours old, source successful within 15 minutes) move an existing symbol earlier in the separate read-only observation scan. They never add broker calls, new symbols, execution candidates, or change execution order. All existing observation symbols still get one pass. Per-symbol calculations use the same candle reads already used by the paced research scan, even for held assets. The scanner runs while the server is LIVE; it is independent of new-entry pause. Source outages and persistence errors remove active news highlights; prior headlines can remain visibly historical.

Technical observations use 50 closed 5m candles preceding the latest closed measurement candle, matching the entry geometry window. They report swing upper/lower touch counts (including provisional channels), regression direction/center, measurement close, volume against the previous 20 candles, and mean dollar volume. Consecutive validated candles are required; open bars never count. A confirmed 2+2 channel, directional regression and a measurement close within one-quarter channel width of the corresponding boundary produces a proximity watch. This is a visualization threshold, not a trading threshold or readiness verdict. Missing volume/liquidity is explicitly shown. Spot channel observations are not Futures confirmation: existing fresh SHORT runner reasons are displayed separately, including global halt reason and “not checked” when stale.

Observations expire at the earlier of three minutes after checking or five minutes after the measured candle closed. Browser transport expires after 90 seconds and is rechecked every ten seconds/visibility change; auth expiry clears the board. Diagnostic decisions have separate 90-second LONG / 120-second SHORT TTLs. Price references are labeled closed-candle prices, not executable quotes. Yellow highlighting respects reduced motion. Graph buttons select assets through the existing read-only chart-selection event.

Bounded data is saved in the existing strategy-review file: up to 150 latest symbol observations, 300 transitions from 24h. Repeat checks of an unchanged bar/reason/touch signature do not duplicate events; latest check time still advances. UI shows 30 recent transitions. Existing strategy cohorts and all execution/account/protection journals are preserved. The installer tests both platforms in an isolated release, then tests the installed Binance integrations (excluding the unrelated legacy Colmex runner on the Binance VPS) before stopping service, backs up changed files, rolls back on startup failure, and checks the observation-only capability. No intent/order is created by installation.
