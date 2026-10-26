# Colmex scan visibility and provisional pivots

The production status inspected on 2026-10-26 contained checks for all 50 configured stocks. Of the last recorded phases, 26 were SEARCH_PEAK. The chart previously rendered only confirmed pivots, hiding the candidate held inside the search state. Therefore an empty chart did not establish that scanning had stopped. The server scans five symbols per 60-second cycle, approximately ten minutes for the full universe under normal conditions; browser-only custom symbols are not automatically enrolled.

The watchlist now shows each stock's last server decision and timestamp, or explicitly reports display-only, never checked, unavailable, stopped, delayed, or market-closed status. The coverage count describes recorded checks, not successful signals or simultaneous scans. Quotes remain independent. This uses the existing status event and creates no extra polling or provider requests.

The chart exposes the current candidate peak/low/recovery/test using neutral dashed labels and hollow arrows. These candidates do not blink or count as completed stages. A collapsible six-stage Wyckoff checklist explains the next missing condition and distinguishes the independent early-wave entry route. Displayed analysis uses closed five-minute candles and includes its own timestamp; the server's last check can be older or based on live-price conditions.

`evaluateWyckoff` exposes `searchCandidate` only when diagnostics are requested. Default outputs and trading conditions are unchanged. The update does not change the universe, cadence, thresholds, orders, position limits, or protections.

Validation: 836 tests passed, including causal candidate-to-confirmed transitions, no invented peaks without qualifying green candles, sale-boundary reset, diagnostic decision equivalence, provisional SVG styling/anchors, coverage and stale/offline/closed states, stable row identity, and disclosure state. Existing captured MSFT reset regression remains passing. Read-only production candle replays showed candidate peaks for AAPL and NVDA, and no eligible candidate for AMZN. No live order was placed for validation.
