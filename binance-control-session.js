/* Device-local authorization; never embeds a shared credential in public code. */
(()=>{
 const key='levi-binance-control-v1';let memory=null;
 window.LEVI_TRADE_AUTH={
  read(){try{const token=localStorage.getItem(key);return token?.length>=32?token:memory;}catch{return memory;}},
  remember(token){memory=token;try{localStorage.setItem(key,token);}catch{}},
  clear(){memory=null;try{localStorage.removeItem(key);}catch{}}
 };
})();
