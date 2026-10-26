# Colmex quantity validation and search-reset diagnostics

## Verified incident (2026-10-26)

The live status was MONITORING, without an account halt, pending order or server error. ADBE had an EARLY_WAVE setup but the recorded entry result was UNKNOWN_QUANTITY_RULES. Read-only MSFT and ADBE chart responses both provided minimum quantity 1 and step 1, with no configured normalized maximum.

`planBuy` multiplied `num(details.maxLot)` by lot size. An explicit null maximum became zero in JavaScript, so the mandatory `max >= min` check rejected the order before submission. TraderEvolution's [instrument contract](https://guide.traderevolution.com/traderevolution-api/traderevolution-apis/client-api/instruments) explicitly returns null for settings that are not configured; its example includes `maxLot: null` and `maxLotInCash: null`.

The quantity parser now accepts only an explicit null maximum as unconfigured. Minimum and lot step remain mandatory and positive; missing, malformed, zero or negative maxima still fail validation. Configured quantity and cash maxima are enforced. The application's $800 budget, three-position cap, cash reserve, signal requirements and native protection orders remain in effect. Broker rejection remains possible; a valid local plan is not evidence of a fill. Public market responses distinguish an unconfigured maximum from invalid rules without exposing credentials or raw account details.

## MSFT chart reset

Replaying the broker candles reproduced the last reset at 19:25 UTC (21:25 Asia/Jerusalem). The low of that candle was 531.29, below the established first low of 531.34 while the algorithm was in RALLY_HIGH. The unchanged rule invalidated that unfinished structure and returned to SEARCH_PEAK. The 11-candle regression fixture is drawn from the original read-only chart response.

Optional diagnostics capture the last reset's time, reason, previous peak/low and the invalidating candle. They do not alter the search or retain an invalid pattern as an entry signal. The chart now explains why the previous markers changed, alongside the last recorded server check. It distinguishes replayed closed-candle analysis from a live server decision. Colmex server checks and decision journals also retain the compact diagnostic on subsequent scans.

No new scheduler, polling interval or data-provider request is added. Entry signals are still scanned by the existing scheduled monitor. Tests cover actual MSFT candle replay, unchanged decisions at every prefix, explicit-null versus invalid quantity metadata, caps/cash/steps, durable-before-submit ordering, and UI state clearing. Tests use an offline fake broker; no order is submitted for verification.
