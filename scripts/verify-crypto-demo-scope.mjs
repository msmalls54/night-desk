import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {withCryptoDemoScope,policyErrors,authority,policyHash,clockContext} from '../src/authority.mjs';
import {createOvernightWorker} from '../src/overnight.mjs';
const start='2026-09-13T05:25:00Z',end='2026-09-13T05:40:00Z';
const scope={id:'mock-final-btc',symbol:'BTCUSD',baseline_qty:'1000',starts_at:start,expires_at:end};
const base={version:'mock-rules',enabled:true,account:'alpaca-paper',timezone:'America/Los_Angeles',start:'22:30',end:'06:30',symbols:['BTCUSD'],max_slippage_bps:25,missed_call_fallback:true,alert_cooldown_minutes:15,rules:[{id:'BTCUSD-percent',symbol:'BTCUSD',target_reduction_pct:10,all:[{metric:'unrealized_pl_percent',op:'lte',value:-0.1}]}]};
const scoped=withCryptoDemoScope(base,JSON.stringify(scope));assert.deepEqual(policyErrors(scoped),[]);assert.equal(withCryptoDemoScope(base,undefined),base);
const makeGrant=p=>({call_id:'mock-verified-call',reason:'first_call_unanswered',policy_hash:policyHash(p),cycle:'demo:'+scope.id,symbol:'BTCUSD',rule_ids:['BTCUSD-percent'],expires_at:'2026-09-13T05:45:00Z'});
for(const at of [start,'2026-09-13T05:30:01Z']){assert.equal(authority(scoped,at).risk_cycle_id,'demo:'+scope.id);assert.equal(authority(scoped,at,'overnight-worker',makeGrant(scoped)).final_authority,true);}
for(const at of ['2026-09-13T05:24:59Z',end])assert.equal(authority(scoped,at,'overnight-worker',makeGrant(scoped)).final_authority,false);
for(const patch of [{cycle:clockContext(start).risk_cycle_id},{cycle:'demo:other'},{symbol:'ETHUSD'},{policy_hash:'wrong'},{rule_ids:['invented']},{expires_at:start}])assert.equal(authority(scoped,start,'overnight-worker',{...makeGrant(scoped),...patch}).final_authority,false);
assert.equal(authority(scoped,start,'phone',makeGrant(scoped)).final_authority,false);
for(const raw of ['{','null','[]',JSON.stringify({...scope,baseline_qty:'0'}),JSON.stringify({...scope,baseline_qty:'-1'}),JSON.stringify({...scope,symbol:'ETHUSD'}),JSON.stringify({...scope,expires_at:'2026-09-13T05:40:01Z'}),JSON.stringify({...scope,extra:true})])assert.ok(policyErrors(withCryptoDemoScope(base,raw)).length,raw);
function fixture(){
  const db=new DatabaseSync(':memory:');let p=structuredClone(scoped),time=new Date(start),qty=1000,posts=0,calls=0,mails=0,order=null;
  const position=()=>({symbol:'BTCUSD',asset_class:'crypto',qty:String(qty),qty_available:String(qty),avg_entry_price:'100.00'});
  const evidence=()=>({symbol:'BTCUSD',at:time.toISOString(),candle_at:new Date(+time-90000).toISOString(),fresh:true,contiguous:true,unrealized_pl_percent:-0.2});
  const riskCalls={status:()=>({provider_verified:true}),ensure:async()=>{calls++;return makeGrant(p);},grant:()=>makeGrant(p)};
  const adapters={ready:()=>true,positions:async()=>[position()],indicators:async()=>evidence(),preflight:async()=>({at:time.toISOString(),position:position(),asset:{symbol:'BTC/USD',class:'crypto',status:'active',tradable:true,min_order_size:'0.01',min_trade_increment:'0.01',price_increment:'0.0001'},open_orders:[],quote:{bid:99.8,at:time.toISOString()}}),submit:async request=>{posts++;qty-=Number(request.qty);return order={...request,id:'mock-order',status:'filled',filled_qty:request.qty,filled_avg_price:request.limit_price};},findOrder:async()=>order,sendEmail:async()=>{mails++;return{message_id:'mock-email'};}};
  const args={db,getPolicy:()=>p,now:()=>time,adapters,riskCalls,decide:async()=>({action:'reduce',rule_id:'BTCUSD-percent',reason:'Mock configured loss threshold'})};
  const first=createOvernightWorker(args),oldCycle=clockContext(time).risk_cycle_id;
  const old={id:'historical-action',symbol:'BTCUSD',night_id:oldCycle,state:'terminal',provider_order:{filled_qty:'200'},email:{final:{status:'accepted'}}};
  db.prepare('INSERT INTO overnight_actions VALUES(?,?)').run(old.id,JSON.stringify(old));db.prepare('INSERT INTO overnight_nights VALUES(?,?)').run(oldCycle+':BTCUSD',JSON.stringify({qty:'2000',at:'2026-09-12T15:00:00Z'}));
  return{db,args,first,old,worker:()=>createOvernightWorker(args),getPolicy:()=>p,setPolicy:v=>p=v,setTime:v=>time=new Date(v),setQty:v=>qty=v,counts:()=>({posts,calls,mails}),oldBaseline:()=>db.prepare('SELECT record FROM overnight_nights WHERE id=?').get(oldCycle+':BTCUSD').record};
}
let f=fixture(),oldBaseline=f.oldBaseline();await f.first.tick();assert.deepEqual(f.counts(),{posts:1,calls:1,mails:1});let action=f.first.status().actions.find(a=>a.id!=='historical-action');assert.equal(action.night_id,'demo:'+scope.id);assert.equal(action.request.qty,'100');assert.equal(action.baseline.qty,'1000');assert.equal(f.oldBaseline(),oldBaseline);assert.deepEqual(JSON.parse(f.db.prepare('SELECT record FROM overnight_actions WHERE id=?').get(f.old.id).record),f.old);
f.setTime('2026-09-13T05:30:01Z');await f.worker().tick();assert.equal(f.counts().posts,1);assert.equal(f.counts().calls,1);f.db.close();
f=fixture();f.setQty(950);await f.first.tick();assert.equal(f.first.status().actions.find(a=>a.id!=='historical-action').request.qty,'50','Other reductions count toward the configured baseline target');f.db.close();
f=fixture();f.setQty(900);await f.first.tick();assert.equal(f.counts().posts,0,'Cumulative target cannot be exceeded');f.db.close();
for(const change of [f=>f.setTime(end),f=>f.setPolicy({...f.getPolicy(),enabled:false}),f=>f.setPolicy({...f.getPolicy(),demo_scope:{...scope,baseline_qty:'2000'}}),f=>f.setPolicy({...f.getPolicy(),version:'changed'})]){
  f=fixture();f.args.riskCalls.ensure=async()=>null;await f.first.tick();change(f);f.args.riskCalls.ensure=async()=>makeGrant(f.getPolicy());await f.worker().tick();assert.equal(f.counts().posts,0);f.db.close();
}
f=fixture();f.args.decide=async()=>{f.setTime(end);return{action:'reduce',rule_id:'BTCUSD-percent',reason:'Expired during model'};};await f.worker().tick();assert.equal(f.counts().posts,0);f.db.close();
console.log('PASS: isolated expiring BTC demo cycle, exact configured baseline, cumulative sizing, historical ledger preservation, restart/day rollover, wrong grants, invalid scopes, pause/expiry/rule/scope changes and expiry during decision. All providers/calls/model/email mocked.');
