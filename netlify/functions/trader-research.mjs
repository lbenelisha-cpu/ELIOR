import {createResearchService, stockSymbol} from '../../lib/trader-research-service.mjs';
const service = createResearchService({secUserAgent: process.env.SEC_USER_AGENT || ''});
export function createResearchHandler(reader = service) {
  return async request => {
    const headers = {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'};
    const reply = (status, data, extra = {}) => new Response(JSON.stringify(data), {status, headers: {...headers, ...extra}});
    if (request.method !== 'GET') return reply(405, {error: 'METHOD_NOT_ALLOWED'}, {Allow: 'GET'});
    try {
      const url = new URL(request.url);
      if ([...url.searchParams.keys()].some(key => key !== 'symbol') || url.searchParams.getAll('symbol').length !== 1) return reply(400, {error: 'INVALID_SYMBOL'});
      const symbol = stockSymbol(url.searchParams.get('symbol'));
      const data = await reader.get(symbol);
      const complete = data.news.status === 'OK' && data.financials.status === 'OK';
      return reply(200, data, {'Cache-Control': 'public, max-age=30, s-maxage=' + (complete ? 900 : 60)});
    } catch (error) {
      const status = error.message === 'INVALID_SYMBOL' ? 400 : error.message === 'RESEARCH_BUSY' ? 429 : 503;
      return reply(status, {error: status === 400 ? 'INVALID_SYMBOL' : status === 429 ? 'RESEARCH_BUSY' : 'RESEARCH_UNAVAILABLE'});
    }
  };
}
export default createResearchHandler();
