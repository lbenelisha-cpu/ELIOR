import {paperStore} from '../../lib/trader-auto-store.mjs';
import {createPaperMarket} from '../../lib/trader-auto-market.mjs';
import {createPaperResearch} from '../../lib/trader-auto-research.mjs';
import {runPaperPlatform} from '../../lib/trader-auto-runner.mjs';

export function createPaperMonitor({getStore = paperStore, readMarket = createPaperMarket(),
  research = createPaperResearch({secUserAgent: process.env.SEC_USER_AGENT || ''}), clock = Date.now,
  env = process.env} = {}) {
  return async (_request, context) => {
    // Runtime context, not a caller-controlled query/header or preview env flag.
    if (context?.deploy?.context !== 'production') return new Response(null, {status: 204});
    const now = clock(), store = getStore();
    const results = await Promise.allSettled(['BINANCE', 'COLMEX'].map(platform => runPaperPlatform({platform,
      store, readMarket, research, now, clock, deadline: now + 26000, enabled: env.TRADER_PAPER_ENABLED !== 'false'})));
    if (results.some(result => result.status === 'rejected')) throw Error('PAPER_CYCLE_STORAGE_OR_STATE_FAILURE');
    return new Response(null, {status: 204});
  };
}
export default createPaperMonitor();
export const config = {schedule: '*/5 * * * *'};
