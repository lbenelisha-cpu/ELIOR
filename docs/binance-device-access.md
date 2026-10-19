# Persistent device authorization without trading password prompts

The browser no longer prompts for BINANCE_CONTROL_TOKEN during a buy, sell,
mode change or other trade control. Disconnected devices open a separate
connection screen; no order is queued or replayed when pairing finishes.
Existing saved valid credentials still work without another prompt.

Pairing is a separate POST /api/binance-control/session request using a six-digit
single-use code generated only by the owner's server-side command. It returns
a random 256-bit device credential that is persisted BEFORE any trade request.
Therefore a later business rejection (insufficient funds, no slot, etc.) does
not lose the saved connection. Unauthorized/expired credentials clear access
and require reconnecting; they never retry an order automatically.

The public server retains authentication on all live order/control routes.
It accepts the existing master bearer or a valid registered device bearer.
The master is never embedded in the site or required in the device's UI. Device
credentials last 180 days, survive server restart, and are stored only as SHA256
hashes in a mode-0600 session file on the server. At most eight devices remain
registered. Revocation removes that device's hash; changing master configuration
invalidates prior device credentials and pending pairing codes. An unconfigured
master cannot enable pairing or trading.

The owner-only pairing command writes a separate mode-0600 pairing file with a
salted hash. The code expires in 15 minutes, is consumed before issuance, and
locks globally after five incorrect attempts, including across restart. Issuing
a replacement code does not overwrite existing registered devices. There is no
HTTP endpoint that generates or reveals a pairing code. The public mode endpoint
advertises only capability/version, not device hashes or pairing details.

The browser keeps its opaque device credential using the existing device-local
storage. Clearing site data, switching browser/PWA storage, session expiry or
using another device requires a new short code. Browsers that deny persistent
storage keep only current-page access. Credentials are never put into a URL,
report, public configuration or generated frontend source.

## Install once

```
cd /opt/levi-binance &&
git fetch origin &&
git show REVISION:scripts/install-binance-device-access.sh > /tmp/levi-device-access-install.sh &&
bash /tmp/levi-device-access-install.sh REVISION
```

The installer syntax-checks staged modules, backs up server/lib, restarts the
service and verifies deviceAuth capability before printing one new six-digit
code. Enter that short code in “חבר מכשיר למסחר” on the app. Subsequent buys and
sells need no typed credential. No manual trade order is submitted by installation
or pairing; the existing automatic policy continues its authorized operation.
If startup verification fails, previous server/lib are restored.

To connect another device or replace an expired code, run from the server repo:

```
node scripts/binance-device-pair.mjs
```

The command reads only local process configuration to locate the session file;
it prints the short pairing code and expiry rather than the master credential.
The app's disconnect button clears local access and attempts authenticated server
revocation. A network failure clears local access but explicitly reports that
server revocation could not be confirmed.

Validation: unit and actual-server-route guard tests cover unauthorized denial,
pair issuance/replay/expiry/five-attempt lock, persistence, master rotation,
revocation and device limits. UI tests cover pairing before a failed business
operation, no order during setup, leading-zero codes, saved-credential reuse,
and no browser password prompts. No real trades were submitted in verification.
