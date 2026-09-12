import { readFileSync } from 'node:fs';
import { createSign, constants } from 'node:crypto';
import path from 'node:path';
import { config, root } from './config.mjs';
import {cryptoSymbols,symbolKey,completedIndicators} from './crypto-indicators.mjs';
export async function json(url, options = {}) {
  const r = await fetch(url, { ...options, signal: options.signal || AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`${new URL(url).hostname}: HTTP ${r.status}`);
  return r.json();
}
export async function alpaca() {
  if (!config.ALPACA_API_KEY || !config.ALPACA_SECRET_KEY) throw new Error('Alpaca paper credentials missing');
  const headers = { 'APCA-API-KEY-ID': config.ALPACA_API_KEY, 'APCA-API-SECRET-KEY': config.ALPACA_SECRET_KEY };
  const [all,account,openOrders,books,assets] = await Promise.all([
    json('https://paper-api.alpaca.markets/v2/positions', { headers }),
    json('https://paper-api.alpaca.markets/v2/account', { headers }),
    json('https://paper-api.alpaca.markets/v2/orders?status=open&limit=500', { headers }),
    json('https://data.alpaca.markets/v1beta3/crypto/us/latest/orderbooks?symbols='+encodeURIComponent(cryptoSymbols.map(s=>s.slice(0,-3)+'/USD').join(',')),{headers}).catch(()=>({orderbooks:{}})),
    json('https://paper-api.alpaca.markets/v2/assets?asset_class=crypto&status=active',{headers})
  ]);
  const positions=all.filter(p=>p.asset_class==='crypto'&&cryptoSymbols.includes(symbolKey(p.symbol))&&Number(p.qty)>0);
  const at=new Date().toISOString();
  let seeds = [];
  try { seeds = JSON.parse(config.ALPACA_SEED_ORDERS || readFileSync(path.join(root, 'PRIVATE/alpaca-starter-orders.json'), 'utf8')); } catch {}
  const orders = await Promise.all(seeds.map(async seed => {
    try {
      const o = await json(`https://paper-api.alpaca.markets/v2/orders/${encodeURIComponent(seed.id)}`, { headers });
      return { id: o.id, symbol: o.symbol, status: o.status, filled_qty: o.filled_qty, filled_avg_price: o.filled_avg_price, filled_at: o.filled_at };
    } catch (e) { return { id: seed.id, symbol: seed.symbol, status: 'readback_unavailable', error: e.message }; }
  }));
  return {at,venue:'Alpaca paper',scope:'Existing BTC, ETH, SOL, XRP and DOGE only; unrelated stocks excluded',account:{status:account.status,trading_blocked:account.trading_blocked,account_blocked:account.account_blocked,buying_power:account.buying_power,non_marginable_buying_power:account.non_marginable_buying_power,cash:account.cash,currency:account.currency,at},open_orders_partial:openOrders.length>=500,open_orders:openOrders.filter(o=>cryptoSymbols.includes(symbolKey(o.symbol))).map(o=>({id:o.id,symbol:symbolKey(o.symbol),side:o.side,qty:o.qty,filled_qty:o.filled_qty,notional:o.notional,status:o.status})),positions:positions.map(p=>{
    const symbol=symbolKey(p.symbol),book=books.orderbooks?.[symbol.slice(0,-3)+'/USD'],quoteAge=(Date.now()-Date.parse(book?.t))/1000;
    const reserved=Number(p.qty)-Number(p.qty_available),asset=assets.find(a=>symbolKey(a.symbol)===symbol);
    return {...Object.fromEntries(['asset_class','qty','qty_available','avg_entry_price','cost_basis','current_price','market_value','unrealized_pl','unrealized_plpc'].map(k=>[k,p[k]??null])),symbol,asset:asset?{min_trade_increment:asset.min_trade_increment,min_order_size:asset.min_order_size,price_increment:asset.price_increment,status:asset.status,tradable:asset.tradable}:null,unrealized_pl_percent:Number.isFinite(Number(p.unrealized_plpc))&&p.unrealized_plpc!=null?Number(p.unrealized_plpc)*100:null,reserved_qty:Number.isFinite(reserved)?String(Math.max(0,reserved)):null,at,quote:{bid:book?.b?.[0]?.p??null,ask:book?.a?.[0]?.p??null,at:book?.t??null,fresh:Number.isFinite(quoteAge)&&quoteAge>=0&&quoteAge<=15,source:'Alpaca crypto order book; separate from Coinbase candles'}};
  }),seed_orders:orders};
}
export async function coinbaseProduct(symbol){
  const key=symbolKey(symbol);if(!cryptoSymbols.includes(key))throw new Error('Unsupported crypto product');
  const product=key.slice(0,-3)+'-USD',base='https://api.exchange.coinbase.com/products/'+product;
  const availability=await json(base);
  if(availability.id!==product||availability.base_currency!==key.slice(0,-3)||availability.quote_currency!=='USD'||availability.status!=='online'||availability.trading_disabled)throw new Error(product+' availability not verified');
  // Explicit completed-minute bounds avoid the lagging cached default-history
  // response observed in the demo without relaxing any freshness check.
  const end=new Date(Math.floor(Date.now()/60000)*60000),start=new Date(+end-30*60000);
  const query='?granularity=60&start='+encodeURIComponent(start.toISOString())+'&end='+encodeURIComponent(end.toISOString());
  return {...completedIndicators(await json(base+'/candles'+query),key),availability:{verified:true,id:availability.id,status:availability.status,at:new Date().toISOString()}};
}
export async function coinbase() {
  const products={};
  // Bounded sequential reads stay below Coinbase public endpoint bursts.
  for(const s of cryptoSymbols)try{products[s]=await coinbaseProduct(s);}catch(e){products[s]={symbol:s,unavailable:true,fresh:false,error:e.message,at:new Date().toISOString()};}
  return {...products.BTCUSD,at:new Date().toISOString(),products};
}
export async function enrichKalshiPositions(positions,{read=json,now=()=>new Date(),signal=AbortSignal.timeout(5000)}={}) {
  const normalized=positions.map(p=>{
    const raw=p.position_fp??p.position;
    const valid=(typeof raw==='string'||typeof raw==='number')&&/^-?\d+(?:\.\d+)?$/.test(String(raw))&&Number.isFinite(Number(raw));
    const value=valid?Number(raw):null;
    return {...p,owned_side:value===null?'unknown':value>0?'yes':value<0?'no':'none',owned_count:value===null?null:String(raw).replace(/^-/,'')};
  });
  const tickers=[...new Set(normalized.filter(p=>['yes','no'].includes(p.owned_side)&&typeof p.ticker==='string'&&p.ticker).map(p=>p.ticker))].slice(0,10);
  const metadata=new Map(await Promise.all(tickers.map(async ticker=>{
    const source_url='https://external-api.demo.kalshi.co/trade-api/v2/markets/'+encodeURIComponent(ticker);
    try{
      const r=await read(source_url,{signal}),m=r?.market;
      if(m?.ticker!==ticker)throw new Error('Market ticker readback mismatch');
      const text=k=>typeof m[k]==='string'&&m[k].trim()?m[k]:null;
      return [ticker,{verified:true,ticker,event_ticker:text('event_ticker'),title:text('title'),subtitle:text('subtitle'),yes_sub_title:text('yes_sub_title'),no_sub_title:text('no_sub_title'),source:'Kalshi demo market metadata',source_url,retrieved_at:now().toISOString(),note:'Names only; not matchup-specific ESPN evidence, an executable quote or trading authority.'}];
    }catch(e){return [ticker,{verified:false,title:null,subtitle:null,yes_sub_title:null,no_sub_title:null,source:'Kalshi demo market metadata',source_url,retrieved_at:now().toISOString(),unavailable_reason:e.message}];}
  })));
  return normalized.map(p=>({...p,market:metadata.get(p.ticker)||{verified:false,title:null,subtitle:null,yes_sub_title:null,no_sub_title:null,unavailable_reason:['yes','no'].includes(p.owned_side)?'Metadata read limit reached or ticker missing':'No verified nonzero owned position',retrieved_at:null}}));
}
export async function kalshi() {
  if (config.KALSHI_ENV !== 'demo') throw new Error('Kalshi demo environment must be explicitly selected');
  const url = new URL('https://external-api.demo.kalshi.co/trade-api/v2/portfolio/positions?limit=100&count_filter=position');
  const timestamp = String(Date.now());
  const signer = createSign('RSA-SHA256'); signer.update(timestamp + 'GET' + url.pathname);
  const signature = signer.sign({ key: config.KALSHI_PRIVATE_KEY || readFileSync(config.KALSHI_PRIVATE_KEY_PATH), padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: constants.RSA_PSS_SALTLEN_DIGEST }, 'base64');
  const r = await json(url, { headers: { 'KALSHI-ACCESS-KEY': config.KALSHI_API_KEY_ID, 'KALSHI-ACCESS-TIMESTAMP': timestamp, 'KALSHI-ACCESS-SIGNATURE': signature } });
  const at=new Date().toISOString();
  const positions=await enrichKalshiPositions(r.market_positions||[]);
  return { at, venue: 'Kalshi demo prediction contracts', positions, cursor: r.cursor || null, partial: !!r.cursor, read_only: true };
}
export function receipt(call) {
  return { subject: 'Night Desk — demo call receipt', text: ['Night Desk — demo/paper only. Not investment advice.', `Call: ${call.call_id}`, `Status: ${call.status}`, ...(call.orders.length ? call.orders.map(o => `${o.status}: ${o.quantity} ${o.side} ${o.market} at $${o.price}; reference ${o.id}; provider order: ${o.provider_order}`) : ['No orders executed.']), 'Generated from the stored call record.'].join('\n') };
}
// Explicit CLI use only; never called by a webhook or scheduler in this skeleton.
export async function sendReceipt(call) {
  if (!config.AGENTMAIL_API_KEY || !config.AGENTMAIL_INBOX || !config.MY_EMAIL) throw new Error('Email configuration incomplete');
  const draft = receipt(call);
  return json(`https://api.agentmail.to/v0/inboxes/${encodeURIComponent(config.AGENTMAIL_INBOX)}/messages/send`, { method: 'POST', headers: { Authorization: `Bearer ${config.AGENTMAIL_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ to: [config.MY_EMAIL], ...draft }) });
}
