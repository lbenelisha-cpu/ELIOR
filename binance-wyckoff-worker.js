import {binanceWyckoffHistory} from './lib/binance-wyckoff-history.mjs?v=20261017-history';
self.onmessage=({data})=>self.postMessage(binanceWyckoffHistory(data.candles,data.rows,data.position));
