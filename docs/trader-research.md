# Trader Research integration

Adds `/trader-research.html` to LEVI INVEST, linked from the home page,
Binance's tool links and Colmex Pro's menu. This is a Hebrew, mobile-friendly
adaptation of four Trader Skill capabilities: stock news, reported company
financials, budget sizing and scenario risk checks. It does not install
Claude, call an LLM, or integrate the upstream broker skill.

## Runtime and deployment

The existing Netlify deployment serves the page and the new GET function
`/.netlify/functions/trader-research?symbol=AAPL`. No dependency was added.
No Binance VM restart, account credentials, trading policy migration or
database migration is needed. These new pages/API are served by Netlify;
the standalone Binance VM's asset allowlist is not extended.

For SEC data, set `SEC_USER_AGENT` in Netlify's function environment to an
actual administrator name and contact email, e.g. `Name contact@your-domain`.
Do not put personal contact information or credentials in source. SEC requires
identified requests. If it is absent/invalid, the API returns CONFIG_REQUIRED
for financials and continues fetching public headlines. A deployment can be
reviewed with headlines and the planner before SEC configuration is available.

Before enabling financials, confirm a production read of AAPL or another
supported SEC registrant, including CIK, statement periods, source URL and
filing dates. Deterministic tests use synthetic fixtures; they do not establish
provider availability. US-GAAP USD financials may be absent for ETFs, foreign
issuers and some businesses. Missing revenue is not a bearish signal.

## Data and limits

- On-demand only: opening the page makes no market-data request. No timer,
  scheduler, persistent observer or LLM spending is added.
- Independent status for news and SEC: OK, UNAVAILABLE, NOT_COVERED or
  CONFIG_REQUIRED. A failed request clears the previous symbol's results.
- Display financial period start/end and each metric's filing date. Latest
  restatements win within the same concept/period; USD and USD/shares are
  required. Quarterly periods cover 80–100 days; annual periods 350–380 days.
  No derived fourth-quarter figures, currency mixing or YTD/quarter mixing.
- Revenue growth requires the same concept and comparable start/end dates
  roughly one year apart. Missing/comparison-incompatible numbers stay null.
- News has valid timestamps, HTTPS links, a seven-day window, URL deduplication
  and a 12-headline cap. Titles are plain text, not HTML or model instructions.
- Only fixed Yahoo/SEC origins; no arbitrary URL, redirects, request headers,
  credentials or account payload may be supplied by clients. GET only.
- 8.5-second outbound deadline, response-body caps, 64-result process cache,
  same-symbol request coalescing and two simultaneous report builds per process.
  SEC starts are spaced by 300 ms within each process. This is not a globally
  distributed rate limit; provider throttling remains possible.
- Successful reports cache 15 minutes in process/CDN; partial reports one minute.
  Browser caching is 30 seconds. Original retrieval timestamp is retained.
  SEC ticker map is cached one day per process. Cold instances can repeat reads;
  this feature still incurs normal Netlify usage when requested.

## Scenario calculator

Runs entirely in the browser using explicitly entered, same-currency values.
No presets of account balances, prices or risk tolerance are invented. It sizes
a new, unleveraged long position within five positions, a maximum 20% allocation
including an entered round-trip cost reserve, available cash and a user-selected
loss budget. Fractional quantities round down to eight decimals; whole-share
mode rounds down to integers. The last slot takes available cash only within
these limits. Duplicate holdings, invalid stops, missing fees or an occupied
fifth slot fail closed. Costs may explicitly be zero if the user enters zero.

This is a hypothetical calculation, not the upstream broker's PASS approval.
It does not validate current account state, quote freshness, broker lot steps,
minimum notional, slippage or executable stop prices. There is no send-order
button or write to shared settings. Modifying inputs hides the old result.
The existing live agent still uses its own allocation and protection rules.

## Verification

`node --test tests/trader-research.test.mjs` checks statement periods/currencies,
restatements, missing values, fee-inclusive sizing, malformed symbols/feeds,
bounded requests/cache behavior, independent provider failure and read-only HTTP.
Run the repository suite with `npm test` as in CI. No live order or real account
mutation is used. Source attribution is in `third_party/trader-skill/`.
