export const cryptoSymbols = ['BTCUSD','ETHUSD','SOLUSD','XRPUSD','DOGEUSD'];
export const symbolKey = s => String(s||'').toUpperCase().replace(/[-/]/g,'');
export function completedIndicators(rows, symbol, now = Date.now()) {
  const key=symbolKey(symbol), cutoff=Math.floor(Number(now)/60000)*60;
  if(!cryptoSymbols.includes(key)||!Array.isArray(rows)) throw new Error('Unsupported Coinbase product or candle response');
  const byTime=new Map(),conflicts=new Set();
  for(const b of rows){
    if(!Array.isArray(b)||b.length!==6||!b.every(Number.isFinite)||!Number.isInteger(b[0])||b[0]%60||b[0]>=cutoff||b.slice(1,5).some(v=>v<=0)||b[5]<0)continue;
    if(byTime.has(b[0])&&JSON.stringify(byTime.get(b[0]))!==JSON.stringify(b))conflicts.add(b[0]);
    byTime.set(b[0],b);
  }
  for(const t of conflicts)byTime.delete(t);
  const bars=[...byTime.values()].sort((a,b)=>a[0]-b[0]),last=bars.at(-1);
  const age=last?Number(now)/1000-last[0]:null, fresh=age!==null&&age>=60&&age<180;
  const window=n=>last&&Array.from({length:n+1},(_,i)=>byTime.get(last[0]-i*60));
  const complete=n=>!!window(n)?.every(Boolean);
  const ret=n=>fresh&&complete(n)?(last[4]/byTime.get(last[0]-n*60)[4]-1)*100:null;
  const mean=complete(20)?window(20).slice(1).reduce((sum,b)=>sum+b[5],0)/20:null;
  return {symbol:key,product_id:key.slice(0,-3)+'-USD',at:new Date(now).toISOString(),source:'Coinbase Exchange completed 1-minute candles',volume_label:'Coinbase venue volume',candle_at:last?new Date(last[0]*1000).toISOString():null,price:last?.[4]??null,fresh,contiguous:complete(20),return_1m:ret(1),return_5m:ret(5),volume_ratio_20m:fresh&&mean>0?last[5]/mean:null,volume:last?.[5]??null,duplicate_conflicts:conflicts.size,unavailable_reasons:[...(!last?['No completed candles']:[]),...(!fresh?['Completed candle is missing or stale']:[]),...(!complete(5)?['Missing exact minute intervals for returns']:[]),...(!complete(20)||!(mean>0)?['Missing or zero preceding 20-minute volume baseline']:[])]};
}
export function ageIndicators(data, now=Date.now()) {
  if(!data||data.unavailable)return data;
  const age=(now-Date.parse(data.candle_at))/1000;
  if(!Number.isFinite(age)||age<60||age>=180)return {...data,fresh:false,return_1m:null,return_5m:null,volume_ratio_20m:null};
  return data;
}
