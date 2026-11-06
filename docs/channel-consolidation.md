# Pre-entry consolidation filter

`CHANNEL_CONSOLIDATION_V1` is a required additional gate for automatic channel
entries on Binance Spot LONG, Binance USD-M SHORT, and Colmex LONG/SHORT. It
does not initiate an order itself. Existing channel geometry, live breakout,
volume, freshness, account, budget and protection gates remain mandatory.
Manual POC orders and management of held positions do not use this entry gate.

The relevant range can occur anywhere in the selected swing channel, including
its middle. It must finish before the entry signal's open candle. The latest
qualifying closed range is used, rather than searching for an older range that
happens to agree with the candidate's direction.

Initial detection parameters (definitions, not statistically optimized values):

- 3 to 8 consecutive closed 5-minute candles, within the selected channel from
  its first confirmed anchor onward. A stock session gap cannot be part of one range.
- Maximum high minus minimum low is at most 35% of full channel width.
- Absolute first-to-last close change is at most 50% of that range.
- Each candle's high/low midpoint must be inside the channel at that candle's
  time. The mean normalized midpoint determines its zone: bottom third LOWER,
  top third UPPER, otherwise MIDDLE. The projected boundary at entry is not used
  to classify a historical range. With equal ending times the longest range wins.
- UPPER permits SHORT, LOWER permits LONG, MIDDLE permits either direction.
  The candidate price must leave the range in the intended direction as well
  as meet the existing channel breakout conditions. No qualifying range means wait.

Only the 50 closed candles available before the signal are used. The open
breakout candle cannot manufacture the consolidation. History and channel
geometry are recalculated at the existing final submission checks. Missing,
changed or incompatible evidence rejects the candidate. Consumed pattern keys
are unchanged, so upgrading cannot make a used channel new again.

Each evaluated gate records policy version, side, zone, start/end times, candle
count, high/low, normalized location, width/drift ratios, distance in bars from
the signal, and pass/block reason. Accepted evidence is saved with the entry
setup. Blocked evidence is exposed in Binance decision/channel checks and
Colmex scan checks. A Colmex consolidation failure at final recheck replaces
the earlier READY display with its blocker. The UI describes this gate as active
only when the server reports its version.

## Installation

Colmex receives the shared policy through its normal Netlify deployment.
Binance VPS uses `scripts/install-channel-consolidation.sh <reviewed-full-sha>`.
The installer stages exact patches to the installed runtime, retains unrelated
local protection integrations, and runs the relevant offline tests before
stopping the service. If the previously authorized SHORT settings exit update
is still absent, it stages that update first, with its existing settings checks.
Thus the owner does not have to guess which previous installation completed.

Unknown source context or failed tests leave deployed files and the service
untouched. Pending SHORT intents block installation. The installer backs up code,
checks for pending intents again after stopping, retains journals, and verifies
both gate versions and unchanged activation flags after startup. A failed health
check restores code without restoring a journal snapshot or reversing trades.
Installation success does not establish exchange acceptance or profitability.

Validation covers upper/lower/central ranges at different temporal locations,
latest-range precedence, absence, drift, narrowness, session gaps, future/open
bars, sloped boundaries, old evidence, final rechecks, and both broker paths.
No historical profit or win-rate improvement has yet been established.
