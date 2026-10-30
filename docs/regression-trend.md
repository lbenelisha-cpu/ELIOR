# Binance Regression Trend display

The chart now fits an ordinary least-squares line to the last 50, 100 (default),
or 200 contiguous closed candles ending at the visible window's end. The source
is close price. Open/future candles are excluded, gaps or malformed OHLC reset
the available window, and insufficient history is shown explicitly.

Upper/lower lines are the fitted line plus/minus 1, 2 (default), or 3 times the
RMS residual sqrt(sum(residual squared)/N). These are descriptive bands, not a
confidence interval or a probability of successful trading. R-squared describes
the fit; it is undefined for constant close prices. The next-bar midpoint shown
in text is a conditional linear extrapolation, not a predicted execution price.

A blue dashed center line, purple boundaries and light fill appear in the shared
Binance renderer for both held positions and analysis. The toggle and period /
width controls affect display only. The channel refits when new candles arrive
or the historical window changes; it is not a frozen historical signal. No BUY,
SELL, stop, account configuration, or order-routing logic reads this module.

Reference: https://www.tradingview.com/support/solutions/43000518108-regression-trend-drawing-tool/
This is our automatic close-price implementation, not an exact replica of every
TradingView indicator or manually anchored drawing setting.

Netlify publishes frontend assets automatically. The VPS has its own static route
map and does not receive Netlify deployments. Run the pinned
scripts/install-binance-pattern-display.sh on the VPS: it installs only the chart
HTML/JS, resistance and regression modules, and inserts their static routes into
the existing server. It checks syntax and offline tests, backs up changed files,
restarts the existing service and verifies both the page and regression module.
It preserves installed engine logic, environment, state and trading settings.
A failed installation restores the changed files; the service restart itself
cannot undo any exchange actions under pre-existing trading settings.
