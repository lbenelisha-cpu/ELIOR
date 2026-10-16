import {simulationStore,STATE_KEY} from '../../lib/colmex-simulation-store.mjs';
import {simulationSummary,SIM_SYMBOLS} from '../../lib/colmex-simulation.mjs';
const reply=(status,data)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
export default async function(request){
 if(request.method!=='GET')return reply(405,{error:'קריאה בלבד'});
 try{const state=await simulationStore().get(STATE_KEY,{type:'json'});const summary=state?simulationSummary(state):null,journalTotal=state?.journal.length||0;
  if(state&&new URL(request.url).searchParams.get('all')!=='1')state.journal=state.journal.slice(-500);
  return reply(200,{active:!!state,symbols:SIM_SYMBOLS,state,summary,journalTotal});}
 catch{return reply(503,{error:'לא ניתן לקרוא את היסטוריית הסימולציה כרגע'});}
}
