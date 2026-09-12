import assert from 'node:assert/strict';
import {btcFifteenMinuteContext,cryptoMarketContext} from '../src/crypto-market-context.mjs';
const market={ticker:'KXBTC15M-26SEP121730-30',event_ticker:'KXBTC15M-26SEP121730',title:'BTC price up in next 15 mins?',status:'active',open_time:'2026-09-12T21:15:00Z',close_time:'2026-09-12T21:30:00Z',expiration_time:'2026-09-19T21:30:00Z',yes_bid_dollars:'0.987',yes_ask_dollars:'0.988',rules_primary:'CF BRTI sixty-second average at close at least the sixty-second average at start.'};
let reads=0;
const check=(markets,at='2026-09-12T21:28:59Z')=>btcFifteenMinuteContext({now:()=>new Date(at),read:async(url,options)=>{reads++;assert.equal(new URL(url).searchParams.get('limit'),'20');assert.equal(new URL(url).hostname,'external-api.kalshi.com');assert.ok(options.signal);return {markets};}});
const r=await check([market]);
assert.equal(r.unavailable,false);assert.equal(r.context_only,true);assert.equal(r.owned,false);assert.equal(r.remaining_at_retrieval_seconds,61);assert.equal(r.close_time,market.close_time);assert.equal(r.yes_bid_dollars,'0.987');assert.equal(r.implied_yes_probability_percent.display,'98.7%–98.8%');assert.equal(r.rules_primary,market.rules_primary);assert.match(r.interval_note,/not the next fifteen minutes/);assert.match(r.implied_yes_probability_percent.interpretation,/not guaranteed/);
for(const bad of [{event_ticker:'KXETH15M-WRONG'},{ticker:'OTHER'},{title:'ETH price up in next 15 mins?'},{status:'closed'},{open_time:'2026-09-12T21:30:00Z'},{close_time:'2026-09-12T21:45:00Z'},{yes_bid_dollars:null},{yes_bid_dollars:'0.99',yes_ask_dollars:'0.98'}])assert.equal((await check([{...market,...bad}])).unavailable,true);
assert.equal((await check([])).unavailable,true);assert.equal((await check([market],'2026-09-12T21:30:00Z')).unavailable,true);assert.equal((await check([market,market])).unavailable,true);
assert.equal((await check([market,{...market,ticker:'KXBTC15M-LATER-45',event_ticker:'KXBTC15M-LATER',open_time:'2026-09-12T21:30:00Z',close_time:'2026-09-12T21:45:00Z'}])).ticker,market.ticker);
const failed=await btcFifteenMinuteContext({read:async()=>{throw new Error('Mock offline');}});assert.equal(failed.unavailable,true);assert.equal(failed.owned,false);
assert.equal(reads,13);
const originalFetch=globalThis.fetch;
try{
  const names={KXBTCD:'Bitcoin',KXETHD:'Ethereum',KXSOL:'Solana',KXXRPD:'XRP',KXDOGED:'Dogecoin'};
  globalThis.fetch=async url=>{
    const series=new URL(url).searchParams.get('series_ticker');
    if(series==='KXBTC15M')return {ok:false,status:503};
    return {ok:true,json:async()=>({markets:[{ticker:series+'-MOCK-YES',event_ticker:series+'-MOCK',title:names[series]+' price',status:'active',close_time:new Date(Date.now()+3600000).toISOString()}]})};
  };
  const all=await cryptoMarketContext({positions:[]});
  assert.equal(all.btc_fifteen_minute.unavailable,true);
  assert.deepEqual(Object.keys(all.products).sort(),['BTCUSD','DOGEUSD','ETHUSD','SOLUSD','XRPUSD']);
  for(const p of Object.values(all.products))assert.equal(p.markets.length,1);
}finally{globalThis.fetch=originalFetch;}
console.log('PASS: current 15-minute BTC identity/window, source/time, remaining interval, raw bid/ask and correct percentage range; expired/future/wrong/ambiguous/invalid/missing data held. Mock GETs only; no orders or model calls.');
