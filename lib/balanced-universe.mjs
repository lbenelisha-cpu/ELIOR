// Verified Binance bStocks catalog, 2026-10-25:
// https://www.binance.com/en/square/post/379677133433669
// QQQB: https://www.bnbchain.org/en/blog/introducing-bstocks-on-bnb-chain-trade-24-7-with-zero-fees-deploy-across-defi-protocols-with-full-self-custody
// Explicit membership: a crypto symbol ending in B is not necessarily a stock.
export const BSTOCK_BASES=new Set('AMDB ARMB AVGOB COINB CRCLB HOODB INTCB MSTRB NVDAB SPCXB TSLAB AAPLB AAOIB ADBEB ALABB AMATB AMCB AMZNB ASMLB ASTSB BABAB BEB BMNRB CBRSB COHRB CRDOB CYPHB DELLB DRAMB FLNCB FWDIB GLWB GOOGLB GSB HPEB IBMB IRENB MARVLB MRVLB MUB NBISB NFLXB NOKB PDDB PYPLB QCOMB RKLBB SHAZB SMCIB SNDKB TSMB WDCB WENB ZMB JPMB LLYB SECZB USDEB EWYB SMHB SOXLB SOXSB SPYB QQQB'.split(' '));
export const isBstock=symbol=>BSTOCK_BASES.has(String(symbol).replace(/USDT$/,''));
export async function balancedUniverse(ranked,size,hasHistory){
 const quota=Math.floor(size/2),counts={crypto:0,stocks:0},selected=[],seen=new Set();
 for(const item of ranked){
  const symbol=typeof item==='string'?item:item.symbol;
  if(seen.has(symbol))continue;seen.add(symbol);
  const group=isBstock(symbol)?'stocks':'crypto';
  if(counts[group]>=quota)continue;
  try{if(!await hasHistory(symbol))continue;}catch{continue;}
  selected.push(symbol);counts[group]++;
  if(counts.crypto===quota&&counts.stocks===quota)break;
 }
 // Do not silently fill a missing stock allocation with crypto (or vice versa).
 return selected;
}
