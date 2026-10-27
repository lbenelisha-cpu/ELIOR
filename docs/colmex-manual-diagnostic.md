# User-submitted Colmex diagnostic purchase

When one legacy automatic BUY is unresolved, an authenticated user can explicitly
submit one independent manual diagnostic BUY up to USD 200 share notional before
fees. Opening the dialog only reads status; only the user's final form submission
calls the existing authenticated manual endpoint. No purchase runs on deployment,
page load, status refresh, or diagnostic availability checks.

The server requires the exact original request ID, the unresolved-order halt,
one unacknowledged non-manual BUY with known limit price and quantity, a different
instrument, available broker history, and no open orders or positions. Other
halts, acknowledgments, extra pending actions, and changed request identities are
not eligible. It reserves the full original order notional plus USD 5 from cash
before evaluating the new order's budget, cash reserve, quantity rules, market
hours, permissions, and attached stop/target. It does not use margin buying power.

The old intent and halt remain intact. The diagnostic intent is persisted in the
existing secondary pending ledger before the single broker write, under the same
CAS lease as the scheduled worker. Its manual request record permanently consumes
this diagnostic attempt for the original request, including rejected or not-sent
attempts. Repeating the same request returns its recorded result without writing.
Preflight failures before reservation do not consume an attempt.

Broker acknowledgment is not a fill. Reconciliation must confirm actual execution
before the holding joins normal protection management. Unknown outcomes retain
their reservation; no automatic resend occurs. Confirmed diagnostic holdings can
be protected by the existing worker while the old unrelated intent remains blocked.
Resolving the diagnostic cannot resolve the original intent.

The UI shows fixed failure codes, HTTP status when available, and the request ID.
Authenticated result polling exposes the same redacted fields and only this
request's review flag. Raw broker messages, bodies, and secrets are not exposed.

Validation uses offline broker fixtures for durability, duplicate prevention,
cash reservations, identity/instrument isolation, account/permission gates,
rejections, unknown outcomes, reconciliation, and protection after confirmed fill.
Deployment verification must remain read-only; do not submit a real test order.
