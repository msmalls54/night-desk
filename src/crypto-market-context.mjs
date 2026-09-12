import {json} from './providers.mjs';
const mappings={BTCUSD:{series:'KXBTCD',name:'Bitcoin'},ETHUSD:{series:'KXETHD',name:'Ethereum'},SOLUSD:{series:'KXSOL',name:'Solana'},XRPUSD:{series:'KXXRPD',name:'XRP'},DOGEUSD:{series:'KXDOGED',name:'Dogecoin'}};
const btcFifteenMinuteUrl='https://external-api.kalshi.com/trade-api/v2/markets?series_ticker=KXBTC15M&status=open&limit=20';
export async function btcFifteenMinuteContext({read=json,now=()=>new Date()}={}){
  const base=()=>({at:now().toISOString(),source:'Kalshi public production Bitcoin 15-minute market snapshot',source_url:btcFifteenMinuteUrl,series:'KXBTC15M',context_only:true,owned:false,ownership_note:'This public lookup does not establish ownership or authorize orders.'});
  try{
    const d=await read(btcFifteenMinuteUrl,{signal:AbortSignal.timeout(5000)}),retrieved=now(),time=+retrieved;
    if(!Array.isArray(d.markets))throw new Error('Market response unavailable');
    const current=d.markets.filter(m=>typeof m.event_ticker==='string'&&m.event_ticker.startsWith('KXBTC15M-')&&typeof m.ticker==='string'&&m.ticker.startsWith(m.event_ticker+'-')&&/\b(?:bitcoin|btc)\b/i.test(m.title||'')&&/\b15\b|fifteen/i.test(m.title||'')&&m.status==='active'&&Date.parse(m.open_time)<=time&&time<Date.parse(m.close_time)&&Date.parse(m.close_time)-Date.parse(m.open_time)===15*60000);
    if(current.length!==1)return {...base(),at:retrieved.toISOString(),partial:!!d.cursor,unavailable:true,reason:current.length?'Multiple matching current intervals; no single market selected':'No verified currently open Bitcoin 15-minute interval in the bounded response'};
    const m=current[0],bid=Number(m.yes_bid_dollars),ask=Number(m.yes_ask_dollars);
    if(m.yes_bid_dollars==null||m.yes_ask_dollars==null||String(m.yes_bid_dollars).trim()===''||String(m.yes_ask_dollars).trim()===''||!Number.isFinite(bid)||!Number.isFinite(ask)||bid<0||ask>1||bid>ask)throw new Error('Current interval quote unavailable or invalid');
    const percent=x=>Number((x*100).toFixed(4));
    return {...base(),at:retrieved.toISOString(),unavailable:false,partial:!!d.cursor,ticker:m.ticker,event_ticker:m.event_ticker,title:m.title,status:m.status,open_time:m.open_time,close_time:m.close_time,remaining_at_retrieval_seconds:Math.floor((Date.parse(m.close_time)-time)/1000),yes_bid_dollars:m.yes_bid_dollars,yes_ask_dollars:m.yes_ask_dollars,implied_yes_probability_percent:{bid:percent(bid),ask:percent(ask),display:`${percent(bid)}%–${percent(ask)}%`,unit:'percent',interpretation:'Quoted YES bid–ask prices expressed as percentages, not guaranteed true probabilities.'},rules_primary:m.rules_primary??null,rules_secondary:m.rules_secondary??null,interval_note:'This is the interval open at retrieval, not the next fifteen minutes from now. Remaining time is measured at retrieval. Treat this snapshot as expired at close_time; expiration_time is not the interval end. The contract uses its stated benchmark/rules, not Coinbase candles or Alpaca P&L.'};
  }catch(e){return {...base(),unavailable:true,reason:e.message};}
}
export async function cryptoMarketContext(holdings){
  const products={};
  const fifteenMinute=btcFifteenMinuteContext();
  await Promise.all(Object.entries(mappings).map(async([symbol,map])=>{
    try{
      const d=await json('https://external-api.kalshi.com/trade-api/v2/markets?series_ticker='+map.series+'&status=open&limit=100');
      const reference=Number(holdings?.positions?.find(p=>p.symbol===symbol)?.current_price);
      const candidates=(d.markets||[]).filter(m=>m.event_ticker?.startsWith(map.series+'-')&&m.title?.toLowerCase().includes(map.name.toLowerCase())&&['active','open'].includes(m.status)&&Date.parse(m.close_time)>Date.now());
      candidates.sort((a,b)=>Date.parse(a.close_time)-Date.parse(b.close_time)||Math.abs(Number(a.floor_strike??a.cap_strike)-reference)-Math.abs(Number(b.floor_strike??b.cap_strike)-reference));
      products[symbol]={at:new Date().toISOString(),series:map.series,context_only:true,owned:false,ownership_note:'Public informational markets; ownership is not asserted by this lookup',partial:!!d.cursor,selection:'At most 3 earliest-expiring matching contracts from a bounded page; nearest strike within the same expiry when a spot snapshot is available',spot_reference:reference||null,spot_reference_at:holdings?.at||null,markets:candidates.slice(0,3).map(m=>({ticker:m.ticker,title:m.title,subtitle:m.subtitle,close_time:m.close_time,floor_strike:m.floor_strike,cap_strike:m.cap_strike,yes_bid_dollars:m.yes_bid_dollars,yes_ask_dollars:m.yes_ask_dollars,rules_primary:m.rules_primary,rules_secondary:m.rules_secondary})),...(candidates.length?{}:{unavailable:true,reason:'No matching unexpired contracts in the bounded response'})};
    }catch(e){products[symbol]={at:new Date().toISOString(),unavailable:true,context_only:true,error:e.message};}
  }));
  return {at:new Date().toISOString(),source:'Kalshi public production prediction-market context; not demo execution quotes',context_only:true,warning:'Contracts concern their stated benchmark, strike and expiry. Prices are not Coinbase returns or Alpaca P&L, and this lookup never authorizes a purchase.',products,btc_fifteen_minute:await fifteenMinute};
}
