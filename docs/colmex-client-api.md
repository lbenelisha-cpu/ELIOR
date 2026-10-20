# Colmex Client API — read-only account connection

Credentials flow confirmed in the broker's integration message (20 October 2026), superseding the generic OAuth instructions. Live schema inspected from https://clientapi.cglms.com/traderevolution/v1/v3/api-docs . Guide: https://guide.traderevolution.com/traderevolution-api/traderevolution-apis/client-api .

Netlify Production environment variables, secret values, Functions scope only:

- `COLMEX_API_LOGIN`: TraderEvolution login supplied by Colmex (not an MT4 account).
- `COLMEX_API_PASSWORD`: account password, preserved including whitespace; never enter it in the frontend.
- `COLMEX_API_READ_TOKEN`: a separate random private viewing credential, at least 24 characters. Existing `COLMEX_DEMO_READ_TOKEN` is accepted as fallback if the new variable is absent. Do not reuse the broker password. The two broker credentials alone do not make account information publicly readable.

After deployment open `/colmex-pro`. The readiness request reveals only configuration presence. Enter the viewing credential once per device; it is saved in localStorage on that device until disconnection. Any script running on the same origin can access that credential: use trusted devices and disconnect on shared computers. No broker password or broker access token reaches the browser or gets written to disk, database, source, response, or logs.

`GET /.netlify/functions/colmex-account?action=status` reports configuration only, without contacting the broker. `GET ...?action=snapshot[&accountId=...]` requires the viewing bearer credential. A single returned account is selected automatically; multiple accounts require selection, checked against the broker's actual list. The public URL itself does not grant viewing access. No CORS wildcard, no tokens in URLs, no arbitrary upstream path or method.

The upstream client only permits POST `/authorize`, GET `/config`, GET `/accounts`, and GET `/accounts/{id}/state|positions`. Tokens are read from `d.access_token`, expiry in epoch seconds. Bearer is case-sensitive. Expired tokens receive at most one fresh login/retry for a read; there is no order API in this adapter. Redirects fail closed. Upstream errors are sanitized, including HTTP-200 error bodies. Wrong broker credentials have a 30-second in-process cooldown; authorization is single-flight per warm function instance. Login also resets cached config.

Account and position arrays are mapped using the current `/config` column IDs, never fixed index guesses. Schema mismatch clears the financial display and shows an error; it never means zero positions. Snapshot and account caches are warm-instance memory only. Default refresh is 30 seconds, conservatively extended for known config rate-limit units. Multiple serverless instances do not share these caches or global rate quotas; an upstream 429 is reported and the UI slows polling. No scheduled reads until a private viewer opens the panel. `observedAt` means retrieval time, not a quote timestamp or an assurance of exchange real-time data.

Local manual tracking, external Twelve Data charts, and Wyckoff paper trading remain separate. This connection does not place/modify/cancel orders and does not automatically trade. No production credentials are used in tests. Production login/account verification requires a configured private viewing credential; a readiness success alone is not proof of broker authentication.
