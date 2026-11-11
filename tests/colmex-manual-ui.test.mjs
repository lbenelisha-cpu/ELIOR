import {entryReasonLabel} from '../lib/colmex-entry-reasons.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import fs from 'node:fs';
function setup({connected=true,storageFails=false}={}){
 const nodes=new Map(),saved=new Map(),calls=[];if(connected)saved.set('levi-colmex-device-v1','colmex-device-'+ 'a'.repeat(64));
 const element=()=>({textContent:'',value:'',disabled:false,hidden:false,showModal(){this.open=true;},close(){this.open=false;},addEventListener(event,cb){this[event]=cb;}});
 const document={hidden:false,addEventListener(){},getElementById(id){if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);}};
 document.getElementById('selectedSymbol').textContent='AAPL';document.getElementById('colmexTradeAmount').value='50';
 let response={ok:true,status:202,json:async()=>({ok:true,status:'PENDING'})};
 const context=vm.createContext({entryReasonLabel,document,localStorage:{getItem:k=>saved.get(k)||null,setItem:(k,v)=>{if(storageFails)throw Error('storage');saved.set(k,v);},removeItem:k=>saved.delete(k)},fetch:async(url,options)=>{calls.push({url,options});return response;},AbortSignal,crypto:{randomUUID:()=> '11111111-1111-4111-8111-111111111111'},setInterval(){}});
 vm.runInContext(fs.readFileSync(new URL('../colmex-manual-ui.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,''),context);
 return {nodes,saved,calls,setResponse:r=>{response=r;}};
}
test('opening buy/sell dialogs never trades; chosen amount and fixed symbol submit without password',async()=>{
 const u=setup();u.nodes.get('colmexManualBuy').click();assert.equal(u.calls.length,0);assert.equal(u.nodes.get('colmexTradeSymbol').value,'AAPL');
 await u.nodes.get('colmexTradeForm').submit({preventDefault(){}});assert.equal(u.calls.length,1);const sent=JSON.parse(u.calls[0].options.body);assert.equal(sent.amountUsd,50);assert.equal(sent.side,'BUY');assert.equal(sent.symbol,'AAPL');assert.match(u.calls[0].options.headers.Authorization,/^Bearer colmex-device-/);assert.equal(u.nodes.get('colmexManualBuy').disabled,true);
 await u.nodes.get('colmexTradeForm').submit({preventDefault(){}});assert.equal(u.calls.length,1);
});
test('no connection disables trade controls, and pending-ID persistence failure sends nothing',async()=>{
 assert.equal(setup({connected:false}).nodes.get('colmexManualSell').disabled,true);
 const u=setup({storageFails:true});u.nodes.get('colmexManualBuy').click();await u.nodes.get('colmexTradeForm').submit({preventDefault(){}});assert.equal(u.calls.length,0);
});
test('unknown result remains pending across refresh; only terminal broker status unlocks buttons',async()=>{
 const u=setup();u.setResponse({ok:false,status:503,json:async()=>({error:'TRADE_RESULT_UNCERTAIN'})});u.nodes.get('colmexManualBuy').click();await u.nodes.get('colmexTradeForm').submit({preventDefault(){}});
 assert.ok(u.saved.has('levi-colmex-manual-pending-v1'));assert.equal(u.nodes.get('colmexManualBuy').disabled,true);
 u.setResponse({ok:true,status:200,json:async()=>({status:'FILLED',symbol:'AAPL'})});await u.nodes.get('colmexCheckTrade').click();assert.equal(u.saved.has('levi-colmex-manual-pending-v1'),false);assert.equal(u.nodes.get('colmexManualBuy').disabled,false);assert.equal(u.calls[1].options.method,'GET');
});
test('expired device authorization reopens one-time pairing instead of trapping the user',async()=>{
 const u=setup();u.setResponse({ok:false,status:401,json:async()=>({error:'DEVICE_REQUIRED'})});u.nodes.get('colmexManualBuy').click();await u.nodes.get('colmexTradeForm').submit({preventDefault(){}});
 assert.equal(u.saved.has('levi-colmex-device-v1'),false);assert.equal(u.nodes.get('colmexPairForm').hidden,false);assert.equal(u.nodes.get('colmexManualBuy').disabled,true);
});
test('explicit rejection and proven not-sent outcomes release local pending without a retry',async()=>{
 for(const status of ['REJECTED','NOT_SENT']){
  const u=setup();u.setResponse({ok:true,status:202,json:async()=>({status,symbol:'AAPL'})});u.nodes.get('colmexManualBuy').click();await u.nodes.get('colmexTradeForm').submit({preventDefault(){}});
  assert.equal(u.saved.has('levi-colmex-manual-pending-v1'),false);assert.equal(u.nodes.get('colmexManualBuy').disabled,false);assert.equal(u.calls.length,1);assert.doesNotMatch(u.nodes.get('colmexManualStatus').textContent,/ממתין לאימות/);
 }
});
test('diagnostic opening is read-only; actual submission requires user form event and stays within 200',async()=>{
 const u=setup();u.setResponse({ok:true,status:200,json:async()=>({manualDiagnostic:{available:true,reviewRequestId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',blockedSymbol:'AMD',maxAmountUsd:200}})});
 await u.nodes.get('colmexDiagnosticBuy').click();assert.equal(u.calls.length,1);assert.equal(u.calls[0].options.method,'GET');assert.equal(u.nodes.get('colmexTradeAmount').max,'200');assert.match(u.nodes.get('colmexTradeDescription').textContent,/כסף אמיתי/);
 u.nodes.get('colmexTradeAmount').value='201';await u.nodes.get('colmexTradeForm').submit({preventDefault(){}});assert.equal(u.calls.length,1);
 u.nodes.get('colmexTradeAmount').value='200';u.setResponse({ok:true,status:202,json:async()=>({status:'PENDING',failure:{code:'WRITE_HTTP_ERROR',httpStatus:400},requestId:'test-request'})});
 await u.nodes.get('colmexTradeForm').submit({preventDefault(){}});assert.equal(u.calls.length,2);const input=JSON.parse(u.calls[1].options.body);assert.equal(input.diagnostic,true);assert.equal(input.amountUsd,200);assert.equal(input.reviewRequestId,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
 assert.match(u.nodes.get('colmexManualStatus').textContent,/HTTP 400/);assert.match(u.nodes.get('colmexManualStatus').textContent,/test-request/);assert.ok(u.saved.has('levi-colmex-manual-pending-v1'));assert.equal(u.nodes.get('colmexDiagnosticBuy').disabled,true);
});
test('diagnostic same-symbol and unavailable offer cannot open a live order form',async()=>{
 for(const offer of [{available:false,reason:'DIAGNOSTIC_ALREADY_USED'},{available:true,blockedSymbol:'AAPL'}]){
  const u=setup();u.setResponse({ok:true,status:200,json:async()=>({manualDiagnostic:offer})});await u.nodes.get('colmexDiagnosticBuy').click();assert.equal(u.calls.length,1);assert.equal(u.calls[0].options.method,'GET');assert.notEqual(u.nodes.get('colmexTradeDialog')?.open,true);
 }
});
test('release dialog reads only until the user confirms; POST records a review action, not an order',async()=>{
 const u=setup();u.setResponse({ok:true,status:200,json:async()=>({reviewRecovery:{available:true,blockedSymbol:'AMD',reservedUsd:805,reviewRequestId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}})});
 await u.nodes.get('colmexReleaseReview').click();assert.equal(u.calls.length,1);assert.equal(u.calls[0].options.method,'GET');assert.equal(u.nodes.get('colmexTradeAmount').disabled,true);assert.match(u.nodes.get('colmexTradeDescription').textContent,/805.00/);assert.match(u.nodes.get('colmexTradeDescription').textContent,/אוטומטיות/);
 u.setResponse({ok:true,status:200,json:async()=>({status:'REVIEW_RELEASED',symbol:'AMD'})});await u.nodes.get('colmexTradeForm').submit({preventDefault(){}});
 const input=JSON.parse(u.calls[1].options.body);assert.equal(input.action,'release_review');assert.equal(input.side,undefined);assert.equal(input.amountUsd,undefined);assert.equal(input.reviewRequestId,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');assert.equal(u.saved.has('levi-colmex-manual-pending-v1'),false);assert.match(u.nodes.get('colmexManualStatus').textContent,/החסימה הגורפת הוסרה/);
});
test('targeted review discloses every isolated symbol, combined cash reservation and limited readiness before confirmation',async()=>{
 const u=setup();u.setResponse({ok:true,status:200,json:async()=>({reviewRecovery:{available:true,blockedSymbol:'TGT',reservedUsd:605,existingReservedUsd:565.83,totalReservedUsd:1170.83,excludedSymbols:['AMD','TGT'],reservedSlots:2,reviewRequestId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc'}})});
 await u.nodes.get('colmexReleaseReview').click();
 const description=u.nodes.get('colmexTradeDescription').textContent;
 for(const value of ['AMD, TGT','605.00','1170.83','2 מתוך 3','לא תספיק','אינה מבטלת'])assert.ok(description.includes(value),value);
 assert.match(u.nodes.get('colmexTradeSubmit').textContent,/מסחר אוטומטי LIVE/);
 assert.equal(u.calls.length,1);assert.equal(u.calls[0].options.method,'GET');
 u.nodes.get('colmexTradeCancel').click();assert.equal(u.calls.length,1);assert.equal(u.saved.has('levi-colmex-manual-pending-v1'),false);
});

test('broker error stays visible in the open dialog and next to quick actions; resubmission stays disabled',async()=>{
 const u=setup();u.nodes.set('colmexQuickTradeStatus',{textContent:''});
 u.setResponse({ok:true,status:202,json:async()=>({status:'PENDING',requestId:'request-1',failure:{code:'WRITE_BROKER_ERROR',httpStatus:200}})});
 u.nodes.get('colmexManualBuy').click();await u.nodes.get('colmexTradeForm').submit({preventDefault(){}});
 assert.equal(u.nodes.get('colmexTradeDialog').open,true);
 assert.match(u.nodes.get('colmexTradeResult').textContent,/הברוקר החזיר שגיאה/);
 assert.equal(u.nodes.get('colmexTradeResult').textContent,u.nodes.get('colmexQuickTradeStatus').textContent);
 assert.equal(u.nodes.get('colmexTradeSubmit').disabled,true);
 await u.nodes.get('colmexTradeForm').submit({preventDefault(){}});assert.equal(u.calls.filter(c=>c.options.method==='POST').length,1);
 u.nodes.get('colmexTradeCancel').click();u.nodes.get('colmexQuickBuy').click();
 assert.match(u.nodes.get('colmexQuickTradeStatus').textContent,/בקשה קודמת/);
 assert.equal(u.nodes.get('colmexManualDetails').open,true);
 assert.equal(u.calls.filter(c=>c.options.method==='POST').length,1);
});
test('a non-JSON gateway error stays visible with its HTTP code and preserves the request identity',async()=>{
 const u=setup();u.setResponse({ok:false,status:502,json:async()=>{throw new SyntaxError('Unexpected token <');}});
 u.nodes.get('colmexManualBuy').click();await u.nodes.get('colmexTradeForm').submit({preventDefault(){}});
 assert.match(u.nodes.get('colmexTradeResult').textContent,/HTTP 502/);assert.equal(u.nodes.get('colmexTradeDialog').open,true);assert.ok(u.saved.has('levi-colmex-manual-pending-v1'));assert.equal(u.nodes.get('colmexTradeSubmit').disabled,true);
});
test('unpaired and invalid-symbol quick actions explain the blockage without sending an order',()=>{
 const u=setup({connected:false});u.nodes.set('colmexQuickTradeStatus',{textContent:''});u.nodes.get('colmexQuickBuy').click();assert.match(u.nodes.get('colmexQuickTradeStatus').textContent,/לחבר את המכשיר/);assert.equal(u.calls.length,0);
 const v=setup();v.nodes.set('colmexQuickTradeStatus',{textContent:''});v.nodes.get('selectedSymbol').textContent='—';v.nodes.get('colmexQuickBuy').click();assert.match(v.nodes.get('colmexQuickTradeStatus').textContent,/מניה תקינה/);assert.equal(v.calls.length,0);
});

test('broker message topic is visible without implying execution or allowing a duplicate',async()=>{
 const u=setup();u.setResponse({ok:true,status:202,json:async()=>({status:'PENDING',requestId:'11111111-1111-4111-8111-111111111111',failure:{code:'WRITE_BROKER_ERROR',httpStatus:200,brokerHint:'SESSION'}})});
 u.nodes.get('colmexManualBuy').click();await u.nodes.get('colmexTradeForm').submit({preventDefault(){}});
 assert.match(u.nodes.get('colmexTradeResult').textContent,/חיבור או סשן/);assert.match(u.nodes.get('colmexTradeResult').textContent,/אינו אישור לתוצאת ההוראה/);
 await u.nodes.get('colmexTradeForm').submit({preventDefault(){}});assert.equal(u.calls.length,1);
});
