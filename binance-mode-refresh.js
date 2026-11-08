(function(root){
 'use strict';
 // Share only concurrent requests, never cached account data. The lightweight
 // status poll is independent of chart, scanner and signed Spot account loads.
 function create({read,context,publish}){
  let pending=null;
  function refresh(){
   const key=context();
   if(pending?.key===key)return pending.promise;
   const request={key};
   request.promise=Promise.resolve().then(read).then(value=>{
    if(context()!==key)throw new Error('MODE_REFRESH_CONTEXT_CHANGED');
    publish(value);return value;
   }).finally(()=>{if(pending===request)pending=null;});
   pending=request;return request.promise;
  }
  return {refresh};
 }
 root.LEVI_MODE_REFRESH={create};
})(globalThis);
