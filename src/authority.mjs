import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { config } from './config.mjs';

export const datetimeTool = { type: 'openrouter:datetime', parameters: { timezone: 'America/Los_Angeles' } };
export const normalizeSymbol = value => String(value || '').replace('/','').toUpperCase();
export const supportedSymbols = ['BTCUSD','ETHUSD','SOLUSD','XRPUSD','DOGEUSD'];
export const metrics = ['return_1m','return_5m','volume_ratio_20m','unrealized_pl','unrealized_pl_percent'];
let policySource,ruleSource;
export function setPolicySource(source,rules){policySource=source;ruleSource=rules;}
export const currentPolicy=()=>policySource?policySource():loadPolicy();
export const currentRules=()=>ruleSource?ruleSource():{policy:loadPolicy(),rows:[]};
export function loadPolicy() {
  try { const p=JSON.parse(config.OVERNIGHT_POLICY_JSON || readFileSync(new URL('./overnight-policy.json',import.meta.url),'utf8')); if(!p||typeof p!=='object'||Array.isArray(p))throw new Error('Invalid policy');return p; }
  catch { return { enabled:false, version:'invalid-policy', rules:[], symbols:[] }; }
}
export function policyHash(policy) { return createHash('sha256').update(JSON.stringify(policy)).digest('hex'); }
export function withCryptoDemoScope(policy,rawScope) {
  if(rawScope===undefined||rawScope===null||rawScope==='')return policy;
  let scope;try{scope=JSON.parse(rawScope);}catch{scope={invalid:true};}
  // An explicitly supplied invalid/null scope cannot fall back to normal authority.
  return {...policy,symbols:['BTCUSD'],rules:Array.isArray(policy.rules)?policy.rules.filter(r=>r.symbol==='BTCUSD'):policy.rules,demo_scope:scope??{invalid:true}};
}
export function policyErrors(p,now) {
  const errors=[];
  if (typeof p.version !== 'string' || !p.version.trim()) errors.push('Policy version missing');
  if (p.account !== 'alpaca-paper') errors.push('Only Alpaca paper execution is supported');
  if (p.timezone !== 'America/Los_Angeles' || p.start !== '22:30' || p.end !== '06:30') errors.push('Window must be 10:30 PM–6:30 AM Pacific');
  if (!Array.isArray(p.symbols) || !p.symbols.length || p.symbols.some(s=>!supportedSymbols.includes(s))) errors.push('Configure at least one crypto reduction rule');
  if (!Number.isFinite(p.max_slippage_bps) || p.max_slippage_bps<=0 || p.max_slippage_bps>1000) errors.push('Set the maximum sale price concession in the rules panel');
  if (!Array.isArray(p.rules) || !p.rules.length || p.rules.length>20) errors.push('Define indicator thresholds and reduction amounts');
  const ids=new Set();
  for (const r of Array.isArray(p.rules)?p.rules:[]) {
    if (!r || typeof r.id!=='string' || !/^[a-zA-Z0-9_-]{1,48}$/.test(r.id) || ids.has(r.id)) { errors.push('Rule IDs must be unique'); continue; }
    ids.add(r.id);
    if (!p.symbols?.includes(r.symbol)) errors.push(`${r.id}: symbol is outside policy`);
    if (!Number.isFinite(r.target_reduction_pct) || r.target_reduction_pct<1 || r.target_reduction_pct>100) errors.push(`${r.id}: set a cumulative reduction of 1–100%`);
    if (!Array.isArray(r.all) || !r.all.length || r.all.length>4) { errors.push(`${r.id}: define one to four required indicators`); continue; }
    for (const c of r.all) if (!c || !metrics.includes(c.metric) || !['lte','gte'].includes(c.op) || !Number.isFinite(c.value)) errors.push(`${r.id}: invalid indicator condition`);
    if (!r.all.some(c=>c && ['return_1m','return_5m','unrealized_pl','unrealized_pl_percent'].includes(c.metric) && c.op==='lte' && Number.isFinite(c.value) && c.value<0)) errors.push(`${r.id}: require a measured adverse price move`);
  }
  if(Object.hasOwn(p,'demo_scope')){
    const s=p.demo_scope,fields=['id','symbol','baseline_qty','starts_at','expires_at'];
    if(!s||typeof s!=='object'||Array.isArray(s)||Object.keys(s).length!==fields.length||fields.some(k=>!Object.hasOwn(s,k)))errors.push('Invalid crypto demo scope fields');
    else{
      if(typeof s.id!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(s.id)||s.symbol!=='BTCUSD'||p.symbols?.length!==1||p.symbols[0]!=='BTCUSD'||p.rules?.some(r=>r.symbol!=='BTCUSD'))errors.push('Crypto demo scope must cover only BTCUSD with a unique ID');
      if(!/^\d+(\.\d{1,18})?$/.test(String(s.baseline_qty))||!Number.isFinite(Number(s.baseline_qty))||Number(s.baseline_qty)<=0)errors.push('Crypto demo baseline must be a positive decimal quantity');
      const start=Date.parse(s.starts_at),end=Date.parse(s.expires_at),iso=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(v);
      if(!iso(s.starts_at)||!iso(s.expires_at)||!Number.isFinite(start)||!Number.isFinite(end)||end<=start||end-start>900000)errors.push('Crypto demo scope must last at most 15 minutes with explicit UTC timestamps');
      else if(now!==undefined&&(+new Date(now)<start||+new Date(now)>=end))errors.push('Crypto demo scope has not started or has expired');
    }
  }
  return [...new Set(errors)];
}
export function clockContext(now=new Date()) {
  const date = new Date(now);
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid server clock');
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(date).map(p=>[p.type,p.value]));
  const minute=Number(parts.hour)*60+Number(parts.minute);
  const within_window=minute>=1350 || minute<390;
  const local_date=`${parts.year}-${parts.month}-${parts.day}`;
  const night= new Date(`${local_date}T12:00:00Z`);
  if (minute<390) night.setUTCDate(night.getUTCDate()-1);
  const cycle=new Date(`${local_date}T12:00:00Z`);if(minute<1350)cycle.setUTCDate(cycle.getUTCDate()-1);
  return { utc:date.toISOString(), pacific:`${local_date} ${parts.hour}:${parts.minute}:${parts.second}`, timezone:'America/Los_Angeles', within_window, risk_cycle_id:cycle.toISOString().slice(0,10), night_id:within_window?night.toISOString().slice(0,10):null, window:'22:30 inclusive–06:30 exclusive Pacific' };
}
export function authority(p=currentPolicy(),now=new Date(),channel='overnight-worker',grant=null) {
  const clock=clockContext(now),errors=policyErrors(p,now),ready=p.enabled===true&&errors.length===0;
  if(p.demo_scope&&typeof p.demo_scope.id==='string')clock.risk_cycle_id='demo:'+p.demo_scope.id;
  const missed=!!(p.missed_call_fallback&&grant&&grant.reason==='first_call_unanswered'&&grant.policy_hash===policyHash(p)&&grant.cycle===clock.risk_cycle_id&&p.symbols?.includes(grant.symbol)&&Array.isArray(grant.rule_ids)&&grant.rule_ids.length&&grant.rule_ids.every(id=>p.rules?.some(r=>r.id===id&&r.symbol===grant.symbol))&&Date.parse(grant.expires_at)>+new Date(now));
  const final_authority=ready&&missed&&channel==='overnight-worker';
  return {...clock,night_id:final_authority?clock.risk_cycle_id:clock.night_id,channel,policy_version:p.version,policy_hash:policyHash(p),enabled:p.enabled===true,ready,final_authority,authority_reason:final_authority?'first_call_unanswered':null,missed_call:missed?grant:null,state:final_authority?'verified_missed_call_reduction':ready?'waiting_for_approval_or_verified_missed_call':'waiting_for_rules',blockers:[...errors,...(!p.enabled?['Automatic reduction rules are paused']:[])],instruction:final_authority?'The first call was verified unanswered. You have authority only to trim or close the covered existing paper crypto position under these exact active rules, then email the actual result. No further confirmation or repeated call. Never add, open an unrelated position, or change rules.':'An answered call requires exact approval. A first verified unanswered call may authorize only covered reductions under complete active rules. Adds always require exact approval and a spending limit. Time, failure, an unverified voicemail and silence alone do not grant authority.'};
}
export function eligibleRules(p,evidence,now=new Date()) {
  if (policyErrors(p,now).length) return [];
  const age=(new Date(now).getTime()-Date.parse(evidence?.at))/1000;
  const candleAge=(new Date(now).getTime()-Date.parse(evidence?.candle_at))/1000;
  if (!Number.isFinite(age) || age<0 || age>90 || !Number.isFinite(candleAge) || candleAge<60 || candleAge>=180 || !evidence.fresh || !evidence.contiguous) return [];
  return p.rules.filter(r=>r.symbol===evidence.symbol && r.all.every(c=>Number.isFinite(evidence[c.metric]) && (c.op==='lte'?evidence[c.metric]<=c.value:evidence[c.metric]>=c.value)));
}
