import test from 'node:test';
import assert from 'node:assert/strict';
import {checkRequest} from '../mt4/live-bridge.mjs';
test('bridge rejects foreign hosts, cross-origin API requests and cross-site resource reads',()=>{
 const req=(headers,url='/api/account')=>({method:'GET',url,headers});
 assert.equal(checkRequest(req({host:'evil.test:22352'}),22352),false);
 assert.equal(checkRequest(req({host:'127.0.0.1:22352',origin:'https://evil.test'}),22352),false);
 assert.equal(checkRequest(req({host:'127.0.0.1:22352','sec-fetch-site':'cross-site'}),22352),false);
 assert.equal(checkRequest(req({host:'127.0.0.1:22352','sec-fetch-site':'same-origin'}),22352),true);
 assert.equal(checkRequest(req({host:'127.0.0.1:22352','sec-fetch-site':'cross-site','sec-fetch-mode':'navigate','sec-fetch-dest':'document'},'/mt4'),22352),true);
});
