import {getStore} from '@netlify/blobs';
export function simulationStore(){return getStore({name:'levi-colmex-wyckoff-simulation-v1',consistency:'strong'});}
export const STATE_KEY='portfolio';
