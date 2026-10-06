import {compareCryptoPortfolios} from './lib/binance-research-engine.mjs';
self.onmessage=event=>{try{self.postMessage({result:compareCryptoPortfolios(event.data.markets,event.data.options)});}catch(error){self.postMessage({error:error.message});}};
