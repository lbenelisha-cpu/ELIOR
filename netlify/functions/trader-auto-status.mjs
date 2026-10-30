import {paperStore} from '../../lib/trader-auto-store.mjs';
import {PAPER_MARKETS, PAPER_POLICY, PAPER_VERSION, checkPaperState, paperSummary} from '../../lib/trader-auto-paper.mjs';
const reply = (status, data) => new Response(JSON.stringify(data), {status,
  headers: {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'}});
export function createPaperStatus({getStore = paperStore, now = Date.now} = {}) {
  return async request => {
    if (request.method !== 'GET') return reply(405, {error: 'READ_ONLY'});
    try {
      const store = getStore();
      const platforms = await Promise.all(Object.entries(PAPER_MARKETS).map(async ([platform, market]) => {
        const state = await store.get(platform.toLowerCase(), {type: 'json'});
        if (state) checkPaperState(state, platform);
        return {platform, ...market, state, summary: state ? paperSummary(state) : null};
      }));
      return reply(200, {version: PAPER_VERSION, mode: 'PAPER_ONLY', servedAt: now(), policy: PAPER_POLICY, platforms});
    } catch {return reply(503, {error: 'PAPER_STATUS_UNAVAILABLE'});}
  };
}
export default createPaperStatus();
