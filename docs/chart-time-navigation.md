# Readable chart windows

Both Binance and Colmex open at the latest candles with a display window sized
to the screen (24–96 bars by default). Zoom changes the number of visible bars;
the time slider and arrow buttons move through history already loaded. The date
labels use Asia/Jerusalem. “All” shows the loaded history, while “Latest” resumes
following incoming bars. Panning into history preserves the first visible candle
by timestamp when refreshes append bars or expire older history. Switching the
symbol, candle interval or data source returns to the latest window.

This is a presentation change. Loaded history, strategy evaluation, broker calls,
entry/exit settings and trading state are not changed by navigation. Binance MA200
is calculated before the visible slice; volume and candle annotations use that
slice. Binance RSI on 5-minute charts and ROC follow the window. The independent
live RSI badge continues showing current entry data. RSI on other chart intervals
is explicitly labelled as recent 5-minute data on a separate range.

Colmex uses actual loaded candle indices, so market closures do not consume slider
space. Its SVG and arrow-caption bounds adapt to screen width. The position-risk
panel sits outside the SVG container so it cannot squeeze the chart or misalign
drawings. The legacy simulation page shares the presentation controls without
adding live trading controls.

Netlify serves both frontends after deploying the merged revision. The Binance
VM also includes three explicit static-asset routes; its existing
`scripts/install-confirmed-quality.sh <full SHA>` stages the required files when
the owner needs to update the VM-hosted frontend. No worker/strategy rollout is
required for visitors using the Netlify frontends.

Validation: viewport tests cover responsive defaults, anchored refreshes,
zoom/pan, context changes, empty/short histories and stock-market gaps. Mobile
arrow bounds and live/simulation page separation are covered by existing suites.
