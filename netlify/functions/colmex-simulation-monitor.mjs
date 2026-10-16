import {td} from '../../lib/agent.mjs';
import {simulationStore} from '../../lib/colmex-simulation-store.mjs';
import {runSimulation} from '../../lib/colmex-simulation-runner.mjs';
export default async function(){
 const raw=process.env.COLMEX_SIM_FEE_BPS,feeBps=raw===undefined||raw===''?null:Number(raw);
 if(feeBps!==null&&(!Number.isFinite(feeBps)||feeBps<0||feeBps>1000))throw Error('INVALID_COLMEX_SIM_FEE_BPS');
 await runSimulation({store:simulationStore(),td,feeBps});return new Response(null,{status:204});
}
export const config={schedule:'* 13-21 * * 1-5'};
