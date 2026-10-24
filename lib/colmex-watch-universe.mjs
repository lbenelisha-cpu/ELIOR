// Fixed watchlist, not a performance ranking. Broker availability and USD share
// rules are verified on every trading decision; unavailable symbols are skipped.
export const COLMEX_WATCH_SYMBOLS=Object.freeze([
 'AAPL','MSFT','NVDA','AMZN','GOOGL','META','TSLA','AVGO','JPM','NFLX',
 'AMD','INTC','PLTR','COIN','ORCL','CRM','ADBE','UBER','DIS','SHOP',
 'BAC','WFC','GS','MS','V','MA','PYPL','AXP','C','WMT',
 'COST','HD','LOW','TGT','NKE','SBUX','MCD','KO','PEP','XOM',
 'CVX','COP','CAT','GE','BA','UNH','JNJ','ABBV','MRK','LLY'
]);
export const COLMEX_SCAN_BATCH_SIZE=5;
