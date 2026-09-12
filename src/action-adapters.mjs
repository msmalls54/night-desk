import {config} from './config.mjs';
import {json} from './providers.mjs';
import {kalshiDemo} from './kalshi-demo.mjs';
import {symbolKey} from './crypto-indicators.mjs';
import {gameTickers,isFresh,feeCeiling} from './position-actions.mjs';
import {units,decimal} from './overnight-orders.mjs';
const base='https://paper-api.alpaca.markets',S=units('1');
const headers=()=>({'APCA-API-KEY-ID':config.ALPACA_API_KEY,'APCA-API-SECRET-KEY':config.ALPACA_SECRET_KEY});
async function paper(path,options={}){return json(base+path,{...options,headers:{...headers(),'Content-Type':'application/json'}});}
export async function preflight(p){
  if(p.venue==='alpaca-paper'){
    const pair=p.symbol.slice(0,-3)+'/USD';
    const marketReduction=p.order_type==='market'&&['trim','close'].includes(p.action);
    const [position,account,asset,orders,books]=await Promise.all([paper('/v2/positions/'+p.symbol),paper('/v2/account'),paper('/v2/assets/'+p.symbol),paper('/v2/orders?status=open&limit=500&symbols='+encodeURIComponent(pair)),marketReduction?Promise.resolve({}):json('https://data.alpaca.markets/v1beta3/crypto/us/latest/orderbooks?symbols='+encodeURIComponent(pair),{headers:headers()})]);
    const b=books.orderbooks?.[pair];return {at:new Date().toISOString(),position,account,asset,orders,quote:{bid:b?.b?.[0]?.p,ask:b?.a?.[0]?.p,at:b?.t}};
  }
  if(p.venue!=='kalshi-demo'||!gameTickers.includes(p.symbol))throw new Error('Unsupported demo contract');
  const ticker=encodeURIComponent(p.symbol),event=p.symbol.slice(0,p.symbol.lastIndexOf('-'));
  const [positionPage,orderPage,balance,m,b,s,f]=await Promise.all([kalshiDemo('GET','/portfolio/positions?ticker='+ticker+'&limit=100'),kalshiDemo('GET','/portfolio/orders?ticker='+ticker+'&status=resting&limit=100'),kalshiDemo('GET','/portfolio/balance'),kalshiDemo('GET','/markets/'+ticker),kalshiDemo('GET','/markets/'+ticker+'/orderbook'),kalshiDemo('GET','/series/KXNCAAFGAME'),kalshiDemo('GET','/events/fee_changes?event_ticker='+event+'&limit=100')]);
  return {at:new Date().toISOString(),position:positionPage.market_positions?.find(v=>v.ticker===p.symbol),positions_partial:!!positionPage.cursor,orders:orderPage.orders,orders_partial:!!orderPage.cursor,balance,market:m.market,book:b.orderbook_fp,series:s.series,fees:f};
}
export function build(r){
  const p=r.preflight,q=units(r.quantity),market=r.order_type==='market',price=market?0n:units(r.limit_price),buy=r.action==='add';
  if(r.order_type!==undefined&&!['market','limit'].includes(r.order_type))throw new Error('Unsupported order type');
  if(market&&(r.venue!=='alpaca-paper'||buy||r.limit_price!=null))throw new Error('Market orders cover paper reductions only');
  if(!isFresh(p.at,15))throw new Error('Execution context is stale');
  if(!Array.isArray(p.orders)||p.orders.length||p.orders_partial||p.positions_partial)throw new Error('Open orders or incomplete account pages must be resolved first');
  if(r.venue==='alpaca-paper'){
    const a=p.asset,pos=p.position,c=p.account;
    if(pos.asset_class!=='crypto'||symbolKey(pos.symbol)!==r.symbol||a.class!=='crypto'||symbolKey(a.symbol)!==r.symbol||a.status!=='active'||a.tradable!==true)throw new Error('Owned crypto asset verification failed');
    if(units(pos.qty)!==units(r.baseline_qty)||(!buy&&q>units(pos.qty_available)))throw new Error('Position or available quantity changed');
    if(c.status!=='ACTIVE'||c.trading_blocked!==false||c.account_blocked!==false)throw new Error('Paper account trading is unavailable');
    if(!market&&(!isFresh(p.quote?.at,15)||!(Number(p.quote?.bid)>0)||!(Number(p.quote?.ask)>0)))throw new Error('A fresh Alpaca bid and ask are required for a limit order');
    const inc=units(a.min_trade_increment),pi=market?0n:units(a.price_increment);
    if(!inc||(!market&&(!pi||price%pi))||q%inc||q<units(a.min_order_size))throw new Error('Approved amount or price does not match the asset precision/minimum');
    if(buy&&(units(c.non_marginable_buying_power)<units(r.spend_usd)||units(c.cash)<units(r.spend_usd)))throw new Error('Insufficient non-margin buying power or cash');
    if(buy&&q*price/S+feeCeiling(r.venue,q,price)>units(r.spend_usd))throw new Error('Add exceeds its approved total budget');
    return {symbol:a.symbol,qty:r.quantity,side:buy?'buy':'sell',type:market?'market':'limit',time_in_force:'ioc',...(!market?{limit_price:r.limit_price}:{}),client_order_id:'nd-action-'+r.id};
  }
  if(r.venue!=='kalshi-demo'||!gameTickers.includes(r.symbol))throw new Error('Only owned demo game contracts are executable');
  const pos=p.position,m=p.market;
  if(!pos||pos.ticker!==r.symbol||!Number(pos.position_fp)||String(Number(pos.position_fp)>0?'yes':'no')!==r.side||units(String(Math.abs(Number(pos.position_fp))))!==units(r.baseline_qty))throw new Error('Owned contract quantity or side changed');
  if(!buy&&q>units(String(Math.abs(Number(pos.position_fp)))))throw new Error('Sale exceeds owned contracts');
  const expectedEvent=r.symbol.slice(0,r.symbol.lastIndexOf('-'));
  if(m.ticker!==r.symbol||m.market_type!=='binary'||m.status!=='active'||Date.parse(m.close_time)<=Date.now()||m.event_ticker!==expectedEvent||!m.rules_primary)throw new Error('Game contract is not active or its identity is unverified');
  if(p.series.fee_type!=='quadratic'||p.series.fee_multiplier!==r.fee_multiplier||p.fees.cursor||!Array.isArray(p.fees.event_fee_changes)||p.fees.event_fee_changes.length)throw new Error('Contract fee terms changed or are unavailable');
  if(q%units('0.01')||price<=0n||price>=S||price%units('0.0001'))throw new Error('Invalid contract count or price precision');
  if(!p.book||!Array.isArray(p.book.yes_dollars)||!Array.isArray(p.book.no_dollars))throw new Error('Contract order book is unavailable');
  const fee=feeCeiling(r.venue,q,price,p.series.fee_multiplier);
  if(fee>units(r.fee_ceiling_usd))throw new Error('Contract fee reserve increased');
  if(buy){const cash=p.balance.balance_dollars!==undefined?units(p.balance.balance_dollars):units(p.balance.balance)/100n;if(q*price/S+fee>units(r.spend_usd)||cash<units(r.spend_usd))throw new Error('Insufficient demo cash or approved budget');}
  return {ticker:r.symbol,client_order_id:r.id,side:(r.side==='yes')===buy?'bid':'ask',count:r.quantity,price:Number(decimal(r.side==='yes'?price:S-price)).toFixed(4),time_in_force:'immediate_or_cancel',self_trade_prevention_type:'taker_at_cross',cancel_order_on_pause:true,reduce_only:!buy};
}
export async function submit(r){
  if(r.state!=='submitting'||!r.approval?.text||!r.request)throw new Error('Stored approval and submission claim required');
  return r.venue==='alpaca-paper'?paper('/v2/orders',{method:'POST',body:JSON.stringify(r.request)}):kalshiDemo('POST','/portfolio/events/orders',r.request);
}
export async function submitMissedCallReduction(r,validateAuthority){
  if(typeof validateAuthority!=='function'||validateAuthority(r)!==true||r.authority?.kind!=='verified_missed_call'||!r.authority?.grant?.call_id)throw new Error('Verified missed-call authority required');
  if(r.state!=='submitting'||r.venue!=='kalshi-demo'||r.action!=='close'||r.side!=='yes'||r.symbol!=='KXNCAAFGAME-26SEP12UNCOWYO-WYO'||!r.request)throw new Error('Only the configured Wyoming closeout is supported');
  const expected=build(r);
  if(JSON.stringify(expected)!==JSON.stringify(r.request)||expected.side!=='ask'||expected.reduce_only!==true||expected.time_in_force!=='immediate_or_cancel')throw new Error('Closeout request changed after preflight');
  return kalshiDemo('POST','/portfolio/events/orders',r.request);
}
export async function find(r){
  if(r.venue==='alpaca-paper'){
    const response=await fetch(base+'/v2/orders:by_client_order_id?client_order_id='+encodeURIComponent(r.request.client_order_id),{headers:headers(),signal:AbortSignal.timeout(10000)});
    if(response.status===404)return null;if(!response.ok)throw new Error('Paper reconciliation unavailable');return response.json();
  }
  const d=await kalshiDemo('GET','/portfolio/orders?ticker='+encodeURIComponent(r.symbol)+'&limit=100');
  if(d.cursor)throw new Error('Order reconciliation needs another page');
  return d.orders?.find(o=>o.client_order_id===r.request.client_order_id)||null;
}
export function verify(r,o){
  const request=r.request;
  if(o.client_order_id!==request.client_order_id)throw new Error('Client order reference mismatch');
  if(r.venue==='alpaca-paper'){
    const market=request.type==='market';
    if(!o.id||symbolKey(o.symbol)!==r.symbol||o.side!==request.side||o.type!==request.type||o.time_in_force!==request.time_in_force||units(o.qty)!==units(r.quantity)||(market?o.limit_price!=null:units(o.limit_price)!==units(r.limit_price))||units(o.filled_qty)<0n||units(o.filled_qty)>units(r.quantity))throw new Error('Paper order readback mismatch');
    if(Number(o.filled_qty)>0&&(!(Number(o.filled_avg_price)>0)||(!market&&(r.action==='add'?Number(o.filled_avg_price)>Number(r.limit_price):Number(o.filled_avg_price)<Number(r.limit_price)))))throw new Error('Fill price is invalid or outside approved limit');
    return {id:o.id,status:o.status,terminal:['filled','canceled','expired','rejected'].includes(o.status),filled_qty:o.filled_qty,filled_avg_price:o.filled_avg_price,provider:o};
  }
  if(!o.order_id||o.ticker!==r.symbol||o.book_side!==request.side||units(o.initial_count_fp)!==units(r.quantity)||units(o.fill_count_fp)>units(r.quantity)||units(o.yes_price_dollars)!==units(request.price)||(r.response?.order_id&&o.order_id!==r.response.order_id))throw new Error('Demo order readback mismatch');
  const cost=Number(o.taker_fill_cost_dollars)+Number(o.maker_fill_cost_dollars),fees=Number(o.taker_fees_dollars)+Number(o.maker_fees_dollars);
  if(r.action==='add'&&(!Number.isFinite(cost+fees)||cost+fees>r.spend_usd+1e-9))throw new Error('Demo fill exceeds approved spending budget');
  return {id:o.order_id,status:o.status,terminal:['executed','canceled'].includes(o.status),filled_qty:o.fill_count_fp,filled_avg_price:null,fees_usd:Number.isFinite(fees)?fees:null,provider:o};
}
