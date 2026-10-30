# Live trade review desk

`/trader-research` now leads with real-account trade review for Binance and Colmex. The previous paper portfolios are collapsed history; their scheduled worker returns without work unless `TRADER_PAPER_ENABLED=true` is explicitly configured.

The live desk reads existing server state and recent technical candidates. Selecting a candidate only populates the symbol. Users choose BUY/SELL and an amount, request a fresh account read, review the platform/symbol/side/amount, then explicitly click the final real-money confirmation. Preparation, polling, connection and cancellation never submit an order. Reviews expire after one minute. Buy checks block on unavailable account verification; sell requires an observed holding. Server-side existing checks remain authoritative. Orders are market orders: prices and fees are not guaranteed, and sells request the available position at execution, not a quoted fixed quantity.

This uses existing authenticated manual endpoints, their existing caps, device credentials, locks and idempotency. It does not install a new broker connection, change permissions, switch account mode or enable a disabled server. An unpaired browser links to the existing pairing screen. Tokens stay out of URLs. Request identity is durably stored locally before the only submission path. Unknown outcomes preserve that identity; checks reconcile it without resubmitting. An acknowledgement is not labeled a fill. A fresh decision is required for a new action.

Existing automatic engines are separate and remain disclosed in the UI. This page does not pause them or convert the whole account into manual-only execution. Approved buys enter the existing protective exit management, including automatic exits; the confirmation text states this. No live order, account activation or protection change was performed during development or validation.

The original Binance quick-sell button now opens a review dialog instead of immediately submitting. Both sides have explicit real-money confirmation labels. Colmex retains its explicit confirmation flow.

The Binance health banner now derives explanations from actual `liveState` fields: unavailable journal, pending order, unmanaged balances, quantity reconciliation, unsettled protection fills, missing/stale protections and known reconciliation errors. It exposes all returned reasons in an expandable list; stale/unknown data never becomes a healthy state, and an unspecified readiness failure is labeled unspecified. This is a display improvement, not remediation of an unknown account state.

Validation uses mocked broker responses and existing offline tests. No final trade button is clicked against production. Live account diagnosis requires the user's authorized device; a browser without that connection cannot establish which readiness flag is currently failing in the user's account.
