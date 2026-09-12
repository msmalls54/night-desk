import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createRiskCalls,phoneAdapter} from '../src/risk-calls.mjs';
import {createOvernightWorker} from '../src/overnight.mjs';
import {authority,clockContext} from '../src/authority.mjs';

// Fictional provider outcome deliberately supplied only through dependency injection.
// This does NOT verify AgentPhone's actual missed-call classification.
function fixture(){
  const db=new DatabaseSync(':memory:');let time=new Date('2026-09-12T20:00:00Z'),calls=0,orders=0,mails=0,qty=1000,lastOrder;
  let policy={version:'synthetic-v1',enabled:true,missed_call_fallback:true,account:'alpaca-paper',timezone:'America/Los_Angeles',start:'22:30',end:'06:30',symbols:['XRPUSD'],max_slippage_bps:50,rules:[{id:'test',symbol:'XRPUSD',target_reduction_pct:20,all:[{metric:'return_5m',op:'lte',value:-1}]}]};
  const position=()=>({symbol:'XRPUSD',asset_class:'crypto',qty:String(qty),qty_available:String(qty),avg_entry_price:'1'});
  const evidence=()=>({symbol:'XRPUSD',at:time.toISOString(),candle_at:new Date(+time-90000).toISOString(),fresh:true,contiguous:true,return_5m:-2,source:'synthetic'});
  let provider={id:'synthetic-call',agentId:'test-agent',toNumber:'+15550000000',direction:'outbound',status:'failed',endedAt:time.toISOString(),transcripts:[]};
  const adapter={ready:()=>true,isNoAnswer:d=>d.disconnectionReason==='SYNTHETIC_MISSED_CALL_ONLY',create:async()=>{calls++;return{id:'synthetic-call'}},read:async()=>provider};
  const args={db,now:()=>time,adapter,ownerPhone:'+15550000000',agentId:'test-agent'};
  let risk=createRiskCalls(args);
  const adapters={ready:()=>true,positions:async()=>[position()],indicators:async()=>evidence(),preflight:async()=>({at:time.toISOString(),position:position(),asset:{symbol:'XRP/USD',class:'crypto',status:'active',tradable:true,min_order_size:'1',min_trade_increment:'0.01',price_increment:'0.0001'},open_orders:[],quote:{bid:1,at:time.toISOString()}}),submit:async r=>{orders++;qty-=Number(r.qty);return lastOrder={...r,id:'synthetic-order',status:'filled',filled_qty:r.qty,filled_avg_price:'1'}},findOrder:async()=>lastOrder,sendEmail:async()=>{mails++;return{message_id:'synthetic-email'}}};
  const workerArgs={db,getPolicy:()=>policy,now:()=>time,adapters,riskCalls:risk,decide:async({eligible,authority:a})=>{assert.equal(a.final_authority,true);return{action:'reduce',rule_id:eligible[0].id,reason:'Synthetic threshold breach'}}};
  const event=(overrides={})=>({event:'agent.call_ended',channel:'voice',agentId:'test-agent',data:{callId:'synthetic-call',to:'+15550000000',direction:'outbound',status:'failed',endedAt:provider.endedAt,disconnectionReason:'SYNTHETIC_MISSED_CALL_ONLY',transcript:[],...overrides}});
  return{db,args,adapter,adapters,workerArgs,worker:()=>createOvernightWorker(workerArgs),risk:()=>risk,event,provider,counts:()=>({calls,orders,mails}),advance:ms=>time=new Date(+time+ms),setTime:t=>time=new Date(t),pause:()=>policy={...policy,enabled:false},edit:()=>policy={...policy,version:'changed'},setFallback:v=>policy={...policy,missed_call_fallback:v},policy:()=>policy,restart:()=>{risk=createRiskCalls(args);workerArgs.riskCalls=risk;}};
}
assert.equal(phoneAdapter.isNoAnswer({disconnectionReason:'failed'}),false,'Generic failures never qualify');
let f=fixture(),w=f.worker();await w.tick();assert.deepEqual(f.counts(),{calls:1,orders:0,mails:0});
f.risk().observe(f.event());await w.tick();assert.deepEqual(f.counts(),{calls:1,orders:1,mails:1});assert.equal(w.status().actions[0].authority.authority_reason,'first_call_unanswered');assert.match(w.status().actions[0].email.final.draft.text,/first unanswered call synthetic-call/);
f.restart();await f.worker().tick();assert.equal(f.counts().orders,1);assert.equal(f.counts().calls,1,'no second attempt after restart');f.db.close();
for(const change of [d=>({...d,disconnectionReason:'failed'}),d=>({...d,disconnectionReason:'voicemail'}),d=>({...d,transcript:[{role:'user',content:'No. Do not sell.'}]}),d=>({...d,direction:'inbound'}),d=>({...d,to:'+15551111111'}),d=>({...d,callId:'unrelated'})]){
  f=fixture();w=f.worker();await w.tick();f.risk().observe({...f.event(),data:change(f.event().data)});await w.tick();assert.equal(f.counts().orders,0);assert.equal(f.counts().calls,1);f.db.close();
}
f=fixture();w=f.worker();await w.tick();f.risk().observe({...f.event(),event:'agent.message',data:{...f.event().data,transcript:'Hello'}});f.risk().observe(f.event());await w.tick();assert.equal(f.counts().orders,0,'interaction latches against later empty no-answer event');f.db.close();
f=fixture();w=f.worker();await w.tick();f.risk().observe(f.event());f.provider.toNumber='+15551111111';await w.tick();assert.equal(f.counts().orders,0,'provider readback must match');f.db.close();
f=fixture();w=f.worker();await w.tick();f.risk().observe(f.event());f.advance(600001);await w.tick();assert.equal(f.counts().orders,0,'expired first-call grant cannot trade');assert.equal(f.counts().calls,1);f.db.close();
f=fixture();w=f.worker();await w.tick();f.risk().observe(f.event());f.pause();await w.tick();assert.equal(f.counts().orders,0,'pause cancels pending authority');f.db.close();
f=fixture();w=f.worker();await w.tick();f.risk().observe(f.event());f.workerArgs.decide=async()=>{f.edit();return{action:'reduce',rule_id:'test',reason:'Changed during model'}};await f.worker().tick();assert.equal(f.counts().orders,0,'policy rechecked after model');f.db.close();
f=fixture();f.adapter.create=async()=>{throw new Error('Unknown creation')};w=f.worker();await w.tick();f.restart();await f.worker().tick();assert.equal(f.risk().status().calls.length,1);assert.equal(f.risk().status().calls[0].state,'creation_unverified');assert.equal(f.counts().orders,0);f.db.close();
f=fixture();f.adapter.ready=()=>false;await f.worker().tick();assert.deepEqual(f.counts(),{calls:0,orders:0,mails:0});f.db.close();
f=fixture();f.setTime('2026-09-12T13:00:00Z');w=f.worker();await w.tick();assert.equal(f.counts().orders,0,'Time alone cannot execute');assert.equal(f.counts().calls,1);f.db.close();
assert.equal(clockContext('2026-09-12T13:29:59Z').risk_cycle_id,clockContext('2026-09-12T13:30:00Z').risk_cycle_id);
console.log('PASS: first-call fallback, answered/voicemail/failed rejection, ownership, provider reconciliation, expiry, policy change, pause, restart, no duplicate calls/orders, shared overnight/daytime target, observed voicemail classification separately verified. Synthetic only: zero external calls, orders or emails.');
