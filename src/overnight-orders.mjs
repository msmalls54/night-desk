import { normalizeSymbol } from './authority.mjs';
// Integer decimal arithmetic avoids rounding a sale above the authorized quantity.
const scale=10n**18n;
export function units(value) {
  const text=String(value);
  if(!/^\d+(\.\d{1,18})?$/.test(text)) throw new Error('Invalid nonnegative decimal');
  const [whole,fraction='']=text.split('.');
  return BigInt(whole)*scale+BigInt(fraction.padEnd(18,'0'));
}
export function decimal(value) { return `${value/scale}.${String(value%scale).padStart(18,'0')}`.replace(/\.?0+$/,''); }
const min=(...values)=>values.reduce((a,b)=>a<b?a:b);
export function buildOrder({policy,rule,baseline,filled,preflight,clientId,now=new Date()}) {
  const p=preflight.position,a=preflight.asset,q=preflight.quote;
  const age=(new Date(now).getTime()-Date.parse(preflight.at))/1000;
  const quoteAge=(new Date(now).getTime()-Date.parse(q.at))/1000;
  if(!Number.isFinite(age)||age<0||age>15||!Number.isFinite(quoteAge)||quoteAge<0||quoteAge>15) throw new Error('Execution data is stale');
  if(p.asset_class!=='crypto'||a.class!=='crypto'||a.status!=='active'||!a.tradable||normalizeSymbol(p.symbol)!==rule.symbol||normalizeSymbol(a.symbol)!==rule.symbol) throw new Error('Position or asset mismatch');
  if(!Array.isArray(preflight.open_orders)||preflight.open_orders.length) throw new Error('An existing order reserves this position');
  const initial=units(baseline.qty),current=units(p.qty),available=units(p.qty_available);
  const target=initial*units(rule.target_reduction_pct)/(100n*scale);
  const already=filled.reduce((sum,qty)=>sum+units(qty),0n);
  const remainingFloor=initial-target;
  const allowed=min(target-already,current-remainingFloor,current,available);
  if(allowed<=0n) return null;
  const increment=units(a.min_trade_increment),priceIncrement=units(a.price_increment),minimum=units(a.min_order_size);
  if(increment<=0n||priceIncrement<=0n||minimum<=0n) throw new Error('Asset precision unavailable');
  const qty=allowed/increment*increment;
  if(qty<minimum) return null;
  if(!Number.isFinite(Number(q.bid))||Number(q.bid)<=0) throw new Error('No executable bid');
  const bid=units(q.bid),bps=units(policy.max_slippage_bps);
  const floor=bid*(10000n*scale-bps)/(10000n*scale);
  // Round the floor up: never allow a lower price than the configured limit.
  const price=(floor+priceIncrement-1n)/priceIncrement*priceIncrement;
  if(price<=0n) throw new Error('Invalid limit price');
  return {symbol:a.symbol,qty:decimal(qty),side:'sell',type:'limit',time_in_force:'ioc',limit_price:decimal(price),client_order_id:clientId};
}
export const terminalStatuses=new Set(['filled','canceled','expired','rejected']);
export function verifiedOrder(order,request) {
  if(!order||typeof order.id!=='string'||order.client_order_id!==request.client_order_id||normalizeSymbol(order.symbol)!==normalizeSymbol(request.symbol)||order.side!=='sell'||units(order.qty)!==units(request.qty)||units(order.filled_qty)>units(request.qty)) throw new Error('Provider order does not match the stored request');
  return {id:order.id,client_order_id:order.client_order_id,symbol:order.symbol,side:order.side,qty:order.qty,status:order.status,filled_qty:order.filled_qty,filled_avg_price:order.filled_avg_price,filled_at:order.filled_at,updated_at:order.updated_at};
}
export function overnightReceipt(action,stage) {
  const o=action.provider_order;
  const lines=['Night Desk — Alpaca paper risk receipt. Not investment advice.',
    `Action reference: ${action.id}`,`Pacific decision time: ${action.authority.pacific}`,`Policy: ${action.policy.version}`,`Symbol: ${action.symbol}`,
    `Rule: ${action.rule.id}; cumulative reduction target ${action.rule.target_reduction_pct}% of first observed Pacific risk-cycle quantity ${action.baseline.qty}.`,
    ...action.rule.all.map(c=>`${c.metric}: observed ${action.evidence[c.metric]}; required ${c.op} ${c.value}`),
    `Evidence: ${action.evidence.source}; completed candle ${action.evidence.candle_at}`,
    `Gemini decision explanation: ${action.decision.reason}`,
    `Requested sale: ${action.request.qty}; limit price ${action.request.limit_price}; immediate-or-cancel.`,
    o?`Provider status: ${o.status}; order ${o.id}.`:'Order outcome unverified. No confirmed fill can be reported.',
    o?`Confirmed filled quantity: ${o.filled_qty}; average fill price: ${o.filled_avg_price??'none reported'}.`:'Reconciliation is pending; no blind order retry will occur.',
    action.remaining?`Remaining paper position: ${action.remaining.qty}; checked ${action.remaining.at}.`:'Remaining position: awaiting provider verification.',
    `Authority: ${action.authority.authority_reason==='first_call_unanswered'?'first unanswered call '+action.authority.missed_call.call_id:'overnight window'}; active rules only. No second call or confirmation required. No new position opened.`,
    'Generated from stored evidence and provider readbacks. A price limit can leave part or all of a reduction unfilled.'];
  return {subject:`Night Desk — ${action.symbol} paper ${stage==='final'?(o?.status||'outcome'):'verification pending'}`,text:lines.join('\n')};
}
