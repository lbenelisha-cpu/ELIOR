// Adapted from Jake Schincariol's trader-analyst. See third_party/trader-skill/.
const DAY = 86400000;
const CONCEPTS = {
  revenue: ['RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues', 'RevenuesNetOfInterestExpense', 'RevenueFromContractWithCustomerIncludingAssessedTax', 'SalesRevenueNet', 'SalesRevenueGoodsNet', 'SalesRevenueServicesNet'],
  netIncome: ['NetIncomeLoss', 'ProfitLoss', 'NetIncomeLossAvailableToCommonStockholdersBasic'],
  eps: ['EarningsPerShareDiluted', 'EarningsPerShareBasicAndDiluted']
};
const date = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const key = row => row.start + '/' + row.end;

export function reportedSeries(data, metric, kind, now = Date.now()) {
  const unit = metric === 'eps' ? 'USD/shares' : 'USD';
  const merged = new Map();
  for (const concept of CONCEPTS[metric] || []) {
    const periods = new Map();
    for (const row of data?.facts?.['us-gaap']?.[concept]?.units?.[unit] || []) {
      if (!date(row.start) || !date(row.end) || !date(row.filed) || !Number.isFinite(row.val)) continue;
      if (!['10-Q', '10-K', '20-F', '40-F'].includes(String(row.form).split('/')[0])) continue;
      if (Date.parse(row.filed) > now || Date.parse(row.end) > Date.parse(row.filed)) continue;
      const days = (Date.parse(row.end) - Date.parse(row.start)) / DAY;
      if (!(kind === 'annual' ? days >= 350 && days <= 380 : days >= 80 && days <= 100)) continue;
      const old = periods.get(key(row));
      if (!old || row.filed > old.filed || row.filed === old.filed && String(row.accn) > String(old.accn)) {
        periods.set(key(row), {value: row.val, start: row.start, end: row.end, filed: row.filed, accession: row.accn || null, concept, unit, form: row.form});
      }
    }
    // Keep concept precedence per exact period, without mixing currencies or durations.
    for (const [period, row] of periods) if (!merged.has(period)) merged.set(period, row);
  }
  return [...merged.values()].sort((a, b) => b.end.localeCompare(a.end) || b.start.localeCompare(a.start));
}

export function analyseCompany(data, symbol, now = Date.now()) {
  if (!data || !data.facts || !/^\d{1,10}$/.test(String(data.cik))) throw Error('INVALID_SEC_RESPONSE');
  const periods = {};
  for (const kind of ['quarterly', 'annual']) {
    const revenue = reportedSeries(data, 'revenue', kind, now);
    const income = new Map(reportedSeries(data, 'netIncome', kind, now).map(row => [key(row), row]));
    const eps = new Map(reportedSeries(data, 'eps', kind, now).map(row => [key(row), row]));
    periods[kind] = revenue.slice(0, 4).map(row => {
      const previous = revenue.find(p => Math.abs((Date.parse(row.end) - Date.parse(p.end)) / DAY - 365) <= 10 && Math.abs((Date.parse(row.start) - Date.parse(p.start)) / DAY - 365) <= 10 && p.concept === row.concept);
      const net = income.get(key(row)) || null;
      return {start: row.start, end: row.end, revenue: row, netIncome: net, eps: eps.get(key(row)) || null,
        revenueGrowthPct: previous?.value > 0 ? 100 * (row.value / previous.value - 1) : null,
        previousRevenue: previous || null, netMarginPct: row.value > 0 && net ? 100 * net.value / row.value : null};
    });
  }
  return {symbol, company: String(data.entityName || symbol).slice(0, 180), cik: String(data.cik).padStart(10, '0'),
    source: 'SEC EDGAR', sourceUrl: 'https://www.sec.gov/edgar/browse/?CIK=' + Number(data.cik),
    periods, method: 'REPORTED_PERIODS_ONLY', currency: 'USD'};
}
