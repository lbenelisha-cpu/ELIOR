# Owner release of the account-wide legacy order review

The authenticated manual panel offers an explicit owner action to release the
account-wide halt while excluding the unresolved stock from new purchases.
Deployment, loading the page, opening the dialog, and GET requests never release
the halt. The final user confirmation clearly states that future scheduled
automatic entries and manual orders on other stocks become possible.

The server accepts only the exact ID of one unacknowledged, non-quarantined automatic BUY
under UNRESOLVED_ORDER_REQUIRES_REVIEW, with known positive quantity and limit
price. It reads fresh broker history, orders, and positions; any open holding,
order, matching historical order for any retained intent, unavailable history,
changed identity, extra non-quarantined pending action, or different halt blocks
release. Previously quarantined BUY intents are allowed alongside this single
target; they cannot be selected or released again. The existing device
authorization, origin checks, CAS lease and durable save apply. The release itself
makes no broker write and returns the saved result idempotently.

`ORDER_REVIEW_RECOVERY_V2` selects the target by its request ID even when an older
quarantine occupies the primary pending field. The confirmation names all
excluded stocks, the new and combined cash reservations, and reserved slots. It
explicitly authorizes future LIVE automatic entries and warns that remaining
cash may be insufficient. It never calls an unresolved order closed, cancelled,
or rejected. The separate USD 200 diagnostic-purchase offer keeps its original
single-intent restriction; this change does not broaden diagnostic trading.

The original pending intent is retained with quarantinedAt, still reconciled on
every normal broker snapshot. Its symbol AND instrument ID block new buys, and it
continues reserving one slot plus its full notional and USD 5 cash headroom. Both
manual and automatic planners subtract that reservation from broker cash. This
can leave insufficient cash for an ordinary USD 800 entry; the configured budget
and protections are not relaxed. Normal new pending actions still stop further
entries, and independent confirmed holdings remain protected.

Late conclusive fills or no-fill terminal orders resolve through the existing
reconciliation rules. Ambiguous evidence and ownership problems still halt the
account. A quarantined unknown outcome is never presented as a confirmed broker
cancellation or rejection. Public status distinguishes an excluded symbol from
an account-wide pending-action block and displays its reserved amount.

Offline tests cover explicit user submission, no broker write during release,
idempotency, persistence failure, same-symbol and instrument blocks, remaining
cash, ordinary manual/automatic entries on other symbols, fresh pending blocks,
and late broker evidence. Production verification must use GET requests only.
