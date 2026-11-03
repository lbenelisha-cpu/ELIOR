# Binance portfolio terminal

The Binance overview uses the existing LEVI identity with a dark navy canvas, cyan panel borders, compact metrics and responsive chart/table grids. Spot equity, wallet allocation, the position map, current holdings and recent exits appear together. Futures keeps its separate balance, position count, health warning and protection table. The chart, POC, settings, scans and reports retain their existing controls and IDs.

The two new metrics report realized net P/L and exit count for the current calendar day in Asia/Jerusalem. They include LONG and SHORT and include partial exits. They do not combine open P/L with historical results or equate wallet value changes with trading profit. Unknown fees/costs, incomplete journals and pending SHORT reconciliation are labelled explicitly. The six most recent recorded exits are shown regardless of day, with exit time and reason. Full reporting and filters remain under P/L.

`binance-terminal.js` is a read-only consumer of the existing dashboard snapshot and the shared P/L reader. Overview reporting refreshes at most once per minute; the full P/L page retains its 15-second refresh. There is one reader, with no added server endpoint, trading API, persisted configuration or execution change. Wallet values expire after 60 seconds and accounting after 120 seconds. Auth loss clears the new view and cancels pending report publication.

Validation: 39 targeted UI/data tests, plus browser checks with explicitly labelled local fixtures at desktop and 390px mobile widths. Preview fixtures and hosting configuration are not deployment files. Production authentication remains the existing device connection.
