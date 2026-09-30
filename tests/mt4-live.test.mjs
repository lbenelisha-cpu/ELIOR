import test from 'node:test';import assert from 'node:assert/strict';
import {validateLiveSnapshot} from '../mt4/live-client.mjs';
const snapshot=()=>({version:1,capturedAt:Date.now()/1000,connected:true,account:{login:'639367',server:'TGLColmex-Live',type:'real',currency:'USD',balance:306,equity:306,profit:0},positions:[],symbols:[]});
test('account balance does not become strategy capital',()=>{const r=validateLiveSnapshot(snapshot());assert.equal(r.account.balance,306);assert.equal(r.budget,150);assert.equal(r.target,120);assert.equal(r.executionEnabled,false);});
test('stale or wrong accounts cannot be displayed as current',()=>{const d=snapshot();d.capturedAt-=60;assert.throws(()=>validateLiveSnapshot(d));d.capturedAt=Date.now()/1000;d.account.server='TGLColmex-Demo';assert.throws(()=>validateLiveSnapshot(d));});
test('disconnected financial values are hidden',()=>{const d=snapshot();d.connected=false;const r=validateLiveSnapshot(d);assert.equal(r.account.balance,null);assert.equal(r.positions,null);});
