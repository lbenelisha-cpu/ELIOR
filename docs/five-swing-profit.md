# Frozen five-wave profit activation

Each entry snapshots the arithmetic mean percentage of the last five completed
upward swings for LONG, downward swings for SHORT, using closed 5m candles and
confirmed two-bar pivots. The snapshot is frozen at entry; later candles do not
change it. Stored V1 `gapPct` is retained as the historical field name for the mean.

The mean sets PROFIT ACTIVATION, not trailing distance. Long activation is entry
* (1 + mean / 100); short activation is entry * (1 - mean / 100). Hard stop and
trailing distance remain from position settings. The trailing gap uses percentage
points of entry, as before the five-wave feature. A previously armed protection
stays armed and a retained stop can only tighten. Activation is not a sale and
cannot guarantee positive realized P/L, particularly if the configured gap exceeds
the activation threshold. Take-profit targets remain unchanged.

Missing or insufficient entry-time history uses the configured activation and is
explicitly labeled as fallback. Old positions without snapshots are not assigned
current waves. Existing valid snapshots can supply the mean without new history.

The UI labels the wave mean as activation; TradingView exports actual server
activation and the configured trailing gap via supported V2 format. Old V3 Pine
snapshots remain readable. Copies are snapshots, not live broker instructions.
