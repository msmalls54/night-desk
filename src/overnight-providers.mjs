import { config } from './config.mjs';
import { json,coinbaseProduct } from './providers.mjs';
import { normalizeSymbol, supportedSymbols } from './authority.mjs';

const paperBase='https://paper-api.alpaca.markets';
function headers() {
  if (!config.ALPACA_API_KEY || !config.ALPACA_SECRET_KEY) throw new Error('Paper credentials missing');
  return {'APCA-API-KEY-ID':config.ALPACA_API_KEY,'APCA-API-SECRET-KEY':config.ALPACA_SECRET_KEY};
}
function pair(symbol) {
  const normalized=normalizeSymbol(symbol);
  if (!supportedSymbols.includes(normalized)) throw new Error('Unsupported crypto symbol');
  return normalized.slice(0,-3)+'/USD';
}
export async function positions() {
  const all=await json(paperBase+'/v2/positions',{headers:headers()});
  return all.filter(p=>p.asset_class==='crypto' && supportedSymbols.includes(normalizeSymbol(p.symbol)) && Number(p.qty)>0).map(p=>({...p,symbol:normalizeSymbol(p.symbol)}));
}
export async function indicators(symbol,position) {
  const c=await coinbaseProduct(symbol);
  return {...c,unrealized_pl:Number.isFinite(Number(position.unrealized_pl))&&position.unrealized_pl!=null?Number(position.unrealized_pl):null,unrealized_pl_percent:Number.isFinite(Number(position.unrealized_plpc))&&position.unrealized_plpc!=null?Number(position.unrealized_plpc)*100:null,pnl_source:'Alpaca paper holding; separate from Coinbase indicators'};
}
export async function preflight(symbol) {
  const s=pair(symbol),h=headers();
  const [position,asset,orders,bookResult]=await Promise.all([
    json(paperBase+'/v2/positions/'+normalizeSymbol(s),{headers:h}),
    json(paperBase+'/v2/assets/'+normalizeSymbol(s),{headers:h}),
    json(paperBase+'/v2/orders?status=open&limit=500&symbols='+encodeURIComponent(s),{headers:h}),
    json('https://data.alpaca.markets/v1beta3/crypto/us/latest/orderbooks?symbols='+encodeURIComponent(s),{headers:h})
  ]);
  const book=bookResult.orderbooks?.[s];
  return {at:new Date().toISOString(),position:{...position,symbol:normalizeSymbol(position.symbol)},asset,open_orders:orders,quote:{bid:book?.b?.[0]?.p,at:book?.t,source:'Alpaca crypto order book'}};
}
export async function submit(order) {
  // Fixed paper endpoint; this adapter cannot route to a real-money account.
  if (order.side!=='sell'||order.type!=='limit'||order.time_in_force!=='ioc'||!/^nd-[a-f0-9]{32}$/.test(order.client_order_id)) throw new Error('Invalid overnight order');
  pair(order.symbol);
  return json(paperBase+'/v2/orders',{method:'POST',headers:{...headers(),'Content-Type':'application/json'},body:JSON.stringify(order)});
}
export async function findOrder(clientId) {
  const r=await fetch(paperBase+'/v2/orders:by_client_order_id?client_order_id='+encodeURIComponent(clientId),{headers:headers(),signal:AbortSignal.timeout(10000)});
  if(r.status===404) return null;
  if(!r.ok) throw new Error('Paper order reconciliation HTTP '+r.status);
  return r.json();
}
export async function sendEmail(draft) {
  if (!config.AGENTMAIL_API_KEY||!config.AGENTMAIL_INBOX||!config.MY_EMAIL) throw new Error('Email configuration incomplete');
  return json('https://api.agentmail.to/v0/inboxes/'+encodeURIComponent(config.AGENTMAIL_INBOX)+'/messages/send',{method:'POST',headers:{Authorization:`Bearer ${config.AGENTMAIL_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({to:[config.MY_EMAIL],subject:draft.subject,text:draft.text})});
}
export const ready=()=>Boolean(config.ALPACA_API_KEY&&config.ALPACA_SECRET_KEY&&config.AGENTMAIL_API_KEY&&config.AGENTMAIL_INBOX&&config.MY_EMAIL&&config.OPENROUTER_API_KEY&&config.OPENROUTER_MODEL);
