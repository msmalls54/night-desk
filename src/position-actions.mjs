import {randomUUID} from 'node:crypto';
import {affirmative} from './gate.mjs';
import {cryptoSymbols,symbolKey} from './crypto-indicators.mjs';
import {units,decimal} from './overnight-orders.mjs';
const S=units('1');
export const gameTickers=['KXNCAAFGAME-26SEP12COLGCMU-COLG','KXNCAAFGAME-26SEP12COLGCMU-CMU','KXNCAAFGAME-26SEP12UNCOWYO-WYO','KXNCAAFGAME-26SEP12UNCOWYO-UNCO'];
const positive=v=>typeof v==='number'&&Number.isFinite(v)&&v>0;
export function isFresh(at,max=90,now=Date.now()){const age=now-Date.parse(at);return Number.isFinite(age)&&age>=0&&age<=max*1000;}
const centsCeil=x=>(x+units('0.01')-1n)/units('0.01')*units('0.01');
export function feeCeiling(venue,qty,price,multiplier=1){
  // Alpaca's published highest taker tier is 0.25%; reserve it conservatively
  // even when fees are deducted from the received coin rather than USD.
  if(venue==='alpaca-paper')return centsCeil(qty*price/S*units('0.0025')/S+1n);
  if(!Number.isFinite(multiplier)||multiplier<0||multiplier>10)throw new Error('Contract fee schedule unavailable');
  // Quadratic fees cannot exceed 0.07 * multiplier * count * 0.25.
  return centsCeil(qty*units('0.0175')/S*units(multiplier)/S+1n);
}
export function proposePositionAction(call,args){
  if(call.mode!=='paper-confirmation'||call.status!=='active')throw new Error('Provider proposals are unavailable in this call');
  if(!args||Object.keys(args).some(k=>!['venue','symbol','action','pct','spend_usd','limit_price','order_type'].includes(k)))throw new Error('Unsupported action fields');
  const {venue,action,limit_price,pct,spend_usd}=args,ur=call.context.user_rules,settings=ur?.settings;
  const orderType=args.order_type??(venue==='alpaca-paper'&&action!=='add'&&limit_price===undefined?'market':'limit');
  const market=orderType==='market';
  if(!['market','limit'].includes(orderType)||!ur?.version||!settings?.allowed_actions.includes(action)||!['add','trim','close'].includes(action))throw new Error('Rules, action or order type are missing');
  if(market&&(venue!=='alpaca-paper'||action==='add'||limit_price!==undefined))throw new Error('Market orders cover only Alpaca paper trims/closes and must not include a limit price');
  if(!market&&!positive(limit_price))throw new Error('An exact limit price is required for this order');
  if(market&&settings.spending_limits_usd[action]!==null)throw new Error('A market sale cannot guarantee the configured action dollar limit; request a limit order');
  if(action==='trim'&&(!positive(pct)||pct>=100))throw new Error('Specify a trim percentage below 100, or request close');
  if(action!=='trim'&&pct!==undefined)throw new Error('Percentage applies only to trims');
  if(action!=='add'&&spend_usd!==undefined)throw new Error('Spending amount applies only to adds');
  if(action==='add'&&(!positive(spend_usd)||!positive(settings.spending_limits_usd.add)||spend_usd>settings.spending_limits_usd.add))throw new Error('Adds need a configured spending limit and an amount within it');
  let symbol=args.symbol,position,side,available,quantum,multiplier=1,contextAt;
  if(venue==='alpaca-paper'){
    symbol=symbolKey(symbol);if(!cryptoSymbols.includes(symbol))throw new Error('Only existing starter crypto holdings are in scope');
    const a=call.context.alpaca;contextAt=a?.at;position=a?.positions?.find(p=>symbolKey(p.symbol)===symbol&&Number(p.qty)>0);side='long';
    if(!position||!isFresh(contextAt)||a.open_orders_partial||!Array.isArray(a.open_orders)||a.open_orders.some(o=>symbolKey(o.symbol)===symbol))throw new Error('Owned position is missing, stale, or reserved by an open order');
    available=position.qty_available;quantum=units(position.asset?.min_trade_increment);
    if(quantum<=0n||position.asset.tradable!==true||position.asset.status!=='active')throw new Error('Asset precision or tradability is unavailable');
  }else if(venue==='kalshi-demo'){
    const k=call.context.kalshi,m=call.context.football?.markets;contextAt=k?.at;
    if(!gameTickers.includes(symbol)||k?.partial||!isFresh(contextAt)||!isFresh(m?.at)||!m.fees_verified)throw new Error('Verified owned game-winner contract context is required');
    position=k.positions?.find(p=>p.ticker===symbol&&Number(p.position_fp)!==0);
    const market=m.markets?.find(p=>p.ticker===symbol);
    if(!position||market?.status!=='active'||!(limit_price<1))throw new Error('Owned active game-winner contract and a price below $1 are required');
    side=Number(position.position_fp)>0?'yes':'no';available=String(Math.abs(Number(position.position_fp)));quantum=units('0.01');multiplier=m.fee_multiplier;
  }else throw new Error('Only Alpaca paper and Kalshi demo execution are allowed');
  const baseline=venue==='alpaca-paper'?String(position.qty):available,price=market?0n:units(limit_price);
  let qty;
  if(action==='add'){
    const budget=units(spend_usd);let lo=0n,hi=budget*S/price/quantum;
    while(lo<hi){const mid=(lo+hi+1n)/2n,q=mid*quantum;if(q*price/S+feeCeiling(venue,q,price,multiplier)<=budget)lo=mid;else hi=mid-1n;}
    qty=lo*quantum;
  }else qty=action==='close'?units(baseline):units(baseline)*units(pct)/(100n*S)/quantum*quantum;
  if(qty<=0n||qty%quantum!==0n)throw new Error('Quantity cannot be expressed at the supported precision; request a valid trim');
  if(action!=='add'&&qty>units(available))throw new Error('Some of the holding is reserved; resolve open orders first');
  const principal=qty*price/S,fee=feeCeiling(venue,qty,price,multiplier);
  const actionLimit=settings.spending_limits_usd[action];
  if(action!=='add'&&actionLimit!==null&&principal>units(actionLimit))throw new Error('Action exceeds its configured dollar limit');
  const pending={kind:'owned-position',id:randomUUID(),venue,symbol,action,side,order_type:orderType,pct:action==='close'?100:pct??null,quantity:decimal(qty),limit_price:market?null:decimal(price),baseline_qty:baseline,spend_usd:action==='add'?spend_usd:null,fee_ceiling_usd:market?null:decimal(fee),maximum_cost_usd:action==='add'?decimal(principal+fee):null,rule_version:ur.version,expires_at:Date.now()+120000,context_at:contextAt,fee_multiplier:multiplier};
  const verb=action==='add'?'Buy more':action==='close'?'Close by selling':'Trim by selling';
  pending.readback=`${venue==='alpaca-paper'?'Alpaca paper':'Kalshi demo'}: ${verb} ${pending.quantity} ${venue==='alpaca-paper'?symbol:side.toUpperCase()+' contracts of '+symbol}${action==='trim'?' ('+pct+' percent of the current holding)':''}, with a ${action==='add'?'maximum':'minimum'} price of $${pending.limit_price} ${venue==='alpaca-paper'?'per coin':'per contract'}. ${action==='add'?'Maximum budget including the fee reserve is $'+spend_usd+'. ':'Estimated fee reserve is $'+pending.fee_ceiling_usd+'. '}This is one immediate-or-cancel order; it may fill partly or not at all. Do you approve this exact action?`;
  if(market)pending.readback=`Alpaca paper: ${action==='close'?'Close':'Trim '+pct+' percent of'} your ${symbol.replace('USD','')} holding by selling ${pending.quantity} coins with one market order. The fill price can change, and it may fill partly or not at all. Do you approve this exact action?`;
  call.pending=pending;return pending.readback;
}
export function createPositionActions({db,getRules,adapters,onUpdate=()=>{},interpret=async()=>null,canExecute=()=>true,now=()=>Date.now()}){
  db.exec('CREATE TABLE IF NOT EXISTS position_actions (id TEXT PRIMARY KEY, record TEXT NOT NULL)');
  const all=()=>db.prepare('SELECT record FROM position_actions ORDER BY rowid DESC').all().map(r=>JSON.parse(r.record));
  const get=id=>{const r=db.prepare('SELECT record FROM position_actions WHERE id=?').get(id);return r?JSON.parse(r.record):null;};
  const save=r=>{db.prepare('UPDATE position_actions SET record=? WHERE id=?').run(JSON.stringify(r),r.id);try{onUpdate(r);}catch{/* The durable order record remains authoritative if the call view cannot update. */}};
  function checkRules(p){const r=getRules();if(r.version!==p.rule_version||!r.settings.allowed_actions.includes(p.action))throw new Error('Rules changed; request a fresh exact proposal');if(p.action==='add'&&(!positive(r.settings.spending_limits_usd.add)||p.spend_usd>r.settings.spending_limits_usd.add))throw new Error('Add spending limit is unavailable or exceeded');}
  async function reconcile(record){
    const r=get(record.id);if(!r||!['submitting','pending','unknown'].includes(r.state))return r;
    try{const o=await adapters.find(r);if(o){r.order=adapters.verify(r,o);r.state=r.order.terminal?'terminal':'pending';}else r.state='unknown';}
    catch(e){r.state='unknown';r.error=e.message;}
    r.checked_at=new Date(now()).toISOString();save(r);return r;
  }
  async function receive(call,text){
    const previous=call.transcript.at(-1),p=call.pending;call.pending=null;
    call.transcript.push({role:'user',content:text,at:new Date(now()).toISOString()});
    if(!p||p.kind!=='owned-position')return null;
    if(!canExecute())return 'The demo test has not been started. No order was submitted.';
    if(call.mode!=='paper-confirmation'||call.status!=='active'||p.expires_at<=now()||previous?.role!=='assistant'||previous.content!==p.readback)return 'That exact proposal is no longer valid. Nothing was submitted. Please request a fresh proposal.';
    let intent=null;
    if(!affirmative(text)){
      try{intent=await interpret({proposal:p.readback,text});}catch{}
      (call.intent_reviews||=[]).push({reply:text,proposal_id:p.id,result:intent});
      if(intent?.intent!=='approve_exact')return null;
    }
    const existing=get(p.id);if(existing)return 'This approval has already been recorded. No order was repeated; its status is '+existing.state+'.';
    let attempted=false;
    let r={...p,call_id:call.call_id,to_number:call.to_number,created_at:new Date(now()).toISOString(),state:'checking',approval:{text,proposal:p.readback,interpretation:intent,at:new Date(now()).toISOString()},context:call.context};
    db.exec('BEGIN IMMEDIATE');
    try{
      if(all().some(a=>a.venue===p.venue&&a.symbol===p.symbol&&!['terminal','held'].includes(a.state)))throw new Error('An earlier action for this position needs reconciliation');
      db.prepare('INSERT INTO position_actions VALUES (?,?)').run(r.id,JSON.stringify(r));db.exec('COMMIT');
    }catch(e){db.exec('ROLLBACK');return e.message+'. Nothing new was submitted.';}
    try{
      checkRules(p);r.preflight=await adapters.preflight(p);checkRules(p);
      if(!canExecute())throw new Error('The demo run is on hold');
      if(p.expires_at<=now())throw new Error('Proposal expired while checking the position');
      r.request=adapters.build(r);r.state='submitting';save(r);
      attempted=true;
      try{r.response=await adapters.submit(r);r.state='pending';}catch(e){r.state='unknown';r.error=e.message;}
      save(r);r=await reconcile(r);
    }catch(e){r.error=e.message;r.state=attempted?'unknown':'held';save(r);}
    call.orders=call.orders.filter(o=>o.action_id!==r.id);
    call.orders.push({action_id:r.id,id:r.order?.id??null,provider_order:!!r.order?.id,venue:r.venue,market:r.symbol,side:r.side,quantity:r.order?.filled_qty??null,price:r.order?.filled_avg_price??null,status:r.order?.status??r.state});
    if(r.state==='held')return 'Nothing was submitted: '+r.error+'. Please request a fresh proposal.';
    if(r.order?.terminal)return `The ${r.venue==='alpaca-paper'?'paper':'demo'} order is ${r.order.status}. Confirmed filled quantity: ${r.order.filled_qty}. Your email receipt will report the stored outcome.`;
    return 'Your approval was recorded, but the final order outcome is not yet verified. I will reconcile it and report the result without repeating the order.';
  }
  return {receive,reconcile,all,get,save};
}
