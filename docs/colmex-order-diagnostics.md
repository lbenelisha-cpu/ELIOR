# Colmex order diagnostics and observation continuity — 27 October 2026

The production worker recorded a BUY attempt for AMD at 17:55 Israel time and
retained an unknown outcome. Its heartbeat continued, while entry scanning stopped
at the pending-intent guard. The original catch discarded the underlying error.
An empty account and a screenshot containing only earlier manual history do not
establish a definitive result for that particular request.

## This release

- Save fixed write-failure codes, stage outcome and HTTP/envelope status for
  future attempts; do not store or publish arbitrary broker messages or tokens.
- Proven failures before the financial HTTP request release their reservation.
  Only a well-formed HTTP 400 response explicitly describing invalid order
  parameters is classified as rejection. Generic errors, transport failures,
  malformed responses, missing order IDs and ambiguous wording remain unknown.
  There are no automatic retries of a financial instruction.
- Preserve request idempotency and consumed patterns. Manual requests also retain
  their final REJECTED/NOT_SENT result, and the UI no longer waits for impossible
  executions after those terminal outcomes.
- During regular trading hours, pending/review states can continue the existing
  five-symbol observation batch after position protection. The branch cannot
  build or submit a fresh buy or consume a new entry pattern. History failures,
  risk-data failures, rate limits and cycle deadlines still stop work as before.
- Publish redacted reconciliation evidence from the existing account/history
  reads: counts, matching method, and request identifier for broker support.
  No extra polling schedule or public mutation endpoint was introduced.
- Display the distinction between active observation scanning and blocked buys.

The earlier AMD intent is **not cleared or resubmitted**. Its original response
cannot be recovered by redeploying this code. It still needs conclusive broker
evidence matching the request, or a separately reviewed owner recovery process.
This release does not change strategy conditions, sizing, permissions or Binance.

## Validation

Offline regression cases cover a full fifty-symbol blocked scan, zero duplicate
orders, protection priority, pre-write authentication/deadline failure, explicit
validation rejection, unknown responses, restart persistence, manual idempotency,
missing legacy diagnostics, privacy, and the distinction shown in the UI.
No live order is placed for verification.

Broker references checked: [trading contract](https://guide.traderevolution.com/traderevolution-api/traderevolution-apis/client-api/trading)
and [official sandbox OpenAPI](https://sandbox-api.traderevolution.com/traderevolution/v1/v3/api-docs).
They do not establish the cause of the historical AMD attempt. The existing
IOC/percentage-bracket payload remains unchanged.
