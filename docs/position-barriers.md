# Internal position barriers

Both applications show a per-position price map with entry, current server stop, profit-protection activation and final take-profit target. The map always fits all reported levels and the last observed price. It is a price map, not historical candles. Binance Futures maps use the exact Futures position; Spot candles are never reused as Futures candles.

The Binance Spot and Colmex candle charts also use these server levels, including the distinct activation and take-profit levels. The default chart height now includes all levels; users can select candle-only height and use the legend/map for levels outside the visible range.

Levels are display-only and never recalculate a trailing stop from a browser price or default settings. Missing levels remain missing. Price/observation timestamps older than two minutes, missing/future timestamps and unavailable account checks mark the map as stale. The map records the original timestamp; repainting does not refresh it. Closed positions and mismatched Spot quantities remove the map. Unsupported and unmanaged positions do not acquire fictitious exit orders.

This does not change order execution, risk settings, native broker orders or the separate TradingView copy freshness rule. Updates use the application's existing position reads and add no network polling.
