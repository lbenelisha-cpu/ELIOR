import {compareMethods} from './lib/meitav-research.mjs';
self.onmessage=event=>{
 try{self.postMessage({result:compareMethods(event.data.markets,event.data.options)});}
 catch(error){self.postMessage({error:error.message});}
};
