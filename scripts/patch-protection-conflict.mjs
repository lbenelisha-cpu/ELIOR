import fs from 'node:fs';
import path from 'node:path';
const patches=JSON.parse(fs.readFileSync(new URL('./protection-conflict-patches.json',import.meta.url),'utf8'));
export const priceCatch=`   catch(e){
    if(definitive(e)){ref.status='REJECTED';this.save();}
    if(e.code===-2021){
     try{
      const latest=await this.contractPrice(p.symbol);
      if(kind==='STOP_MARKET'&&latest>=price||kind==='TAKE_PROFIT_MARKET'&&latest<=price){
       ref.status='REJECTED';this.save();
       e.exitReason=kind==='STOP_MARKET'?'STOP_LOSS':'CHANNEL_TAKE_PROFIT';
      }
     }catch(checkError){e.priceCheckError=checkError.message;}
    }
    throw e;
   }`;
const normalized=s=>s.split('\n').map(x=>x.trim()).join('\n');
export function patchProtectionConflict(root){
 const file=path.join(root,'lib/futures-short-runner.mjs');let text=fs.readFileSync(file,'utf8');
 for(const [before,after] of patches){
  if(before===patches[1][0]&&text.includes(after.slice(after.indexOf('    // Binance'),after.indexOf('    throw e;'))))continue;
  if(before===patches[1][0]&&!text.includes(before)&&!text.includes(after)){
   const start=text.indexOf('   catch(e){',text.indexOf(' async ensureAlgo('));
   const end=text.indexOf('   const o=await this.queryAlgo(p,ref);',start);
   const actual=text.slice(start,end).trimEnd();
   if(normalized(actual)!==normalized(priceCatch))throw Error('Unrecognized protection price catch; no files changed');
   // Keep the installed -2021 contract-price handling byte-for-byte.
   const fallback=after.slice(after.indexOf('    // Binance'),after.indexOf('    throw e;'));
   const insertion=actual.indexOf('    if(e.code===-2021)');
   if(insertion<0)throw Error('Unrecognized protection price indent; no files changed');
   text=text.slice(0,start)+actual.slice(0,insertion)+fallback+actual.slice(insertion)+text.slice(start+actual.length);
   continue;
  }
  if(text.includes(after)||before===patches[1][0]&&text.includes(after.slice(after.indexOf('    // Binance'),after.indexOf('    throw e;'))))continue;if(text.split(before).length!==2)throw Error('Unrecognized protection runner; no files changed');text=text.replace(before,after);}
 fs.writeFileSync(file,text);
}
if(process.argv[1]===new URL(import.meta.url).pathname)patchProtectionConflict(process.argv[2]);
