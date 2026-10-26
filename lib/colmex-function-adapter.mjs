// Native Netlify functions receive the server-only Blobs runtime context.
// Keep the tested read handlers independent of that runtime.
export function colmexFetchHandler(handler){
 return async request=>{
  const url=new URL(request.url);
  const result=await handler({httpMethod:request.method,queryStringParameters:Object.fromEntries(url.searchParams),headers:Object.fromEntries(request.headers)});
  return new Response(result.body,{status:result.statusCode,headers:result.headers});
 };
}
