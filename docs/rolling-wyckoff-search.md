# Current Wyckoff search: Binance and Colmex Pro

Without a position, five-minute Spring/RSI scans replace unfinished structures when a newer eligible local peak is confirmed by the next closed candle. The two green candles before the peak remain required. Peaks may be lower than the previous setup's peak.

An unfinished structure expires after 78 closed trading candles (6.5 trading hours). An unbought Spring expires after three subsequent closed candles; updating its low does not extend that lifetime. Session closures do not add candles. These are new freshness limits; historical occurrence reconstruction remains available for inspection.

Entry still requires the complete structure, fresh latest bars, fresh quote and current RSI (14), inclusive 0–30, plus the existing platform filters. RSI uses the full available close history and the current quote; resetting the setup does not reset RSI. A sale starts a search for a peak after that sale. Position exits continue using the saved entry and observed peak.

Colmex stores the entry setup with new live positions and returns it to the chart. Older positions lacking a saved setup retain their original exit management; their entry pivots cannot be reconstructed reliably. Live and historical chart annotations remain analytical, separate from verified order fills.

## Delivery

Netlify deploys the frontend and Colmex functions through the existing repository deployment workflow after merge. Binance's VM requires installing the reviewed revision and restarting its service. The installer stages and syntax-checks only changed Binance files, backs up existing code, and preserves account state and journals. It does not call an order endpoint.
