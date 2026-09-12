import {readFileSync,statSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {root} from './config.mjs';
import path from 'node:path';
import {cryptoSymbols} from './crypto-indicators.mjs';
const rulesPath=path.join(root,'rules.md');
export const defaultSettings=()=>({allowed_actions:['add','trim','close'],spending_limits_usd:{add:null,trim:null,close:null},crypto_loss_thresholds:Object.fromEntries(cryptoSymbols.map(s=>[s,{dollars:null,percent:null}])),sports_loss_thresholds:{contract_price_points:null,dollars:null},quiet_hours:{start:'22:30',end:'06:30',timezone:'America/Los_Angeles'},alert_cooldown_minutes:null,retry_count:0,missed_call_reductions:{enabled:false,crypto_target_pct:Object.fromEntries(cryptoSymbols.map(s=>[s,null])),max_price_concession_bps:null}});
export function validateSettings(value){
  const v=structuredClone(value),keys=Object.keys(defaultSettings());
  if(!v||Object.keys(v).some(k=>!keys.includes(k))||keys.some(k=>!(k in v)))throw new Error('Supply the complete supported settings');
  if(!Array.isArray(v.allowed_actions)||new Set(v.allowed_actions).size!==v.allowed_actions.length||v.allowed_actions.some(a=>!['add','trim','close'].includes(a)))throw new Error('Invalid allowed actions');
  const threshold=(x,name,max=1e9)=>{if(x!==null&&(typeof x!=='number'||!Number.isFinite(x)||x<=0||x>max))throw new Error('Invalid '+name);};
  function fields(obj,names){if(!obj||typeof obj!=='object'||Array.isArray(obj)||Object.keys(obj).length!==names.length||names.some(k=>!(k in obj)))throw new Error('Invalid settings fields');}
  fields(v.spending_limits_usd,['add','trim','close']);for(const a of ['add','trim','close'])threshold(v.spending_limits_usd[a],a+' spending limit');
  fields(v.crypto_loss_thresholds,cryptoSymbols);for(const s of cryptoSymbols){fields(v.crypto_loss_thresholds[s],['dollars','percent']);threshold(v.crypto_loss_thresholds[s].dollars,s+' loss dollars');threshold(v.crypto_loss_thresholds[s].percent,s+' loss percent',100);}
  fields(v.sports_loss_thresholds,['contract_price_points','dollars']);threshold(v.sports_loss_thresholds.contract_price_points,'contract price points',100);threshold(v.sports_loss_thresholds.dollars,'sports loss dollars');
  fields(v.quiet_hours,['start','end','timezone']);if(v.quiet_hours.timezone!=='America/Los_Angeles'||[v.quiet_hours.start,v.quiet_hours.end].some(t=>typeof t!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(t)))throw new Error('Invalid Pacific quiet hours');
  threshold(v.alert_cooldown_minutes,'alert cooldown',1440);
  if(!Number.isInteger(v.retry_count)||v.retry_count<0||v.retry_count>3)throw new Error('Retry count must be 0–3');
  fields(v.missed_call_reductions,['enabled','crypto_target_pct','max_price_concession_bps']);if(typeof v.missed_call_reductions.enabled!=='boolean')throw new Error('Invalid reduction enabled flag');
  fields(v.missed_call_reductions.crypto_target_pct,cryptoSymbols);for(const s of cryptoSymbols)threshold(v.missed_call_reductions.crypto_target_pct[s],s+' cumulative reduction percent',100);
  threshold(v.missed_call_reductions.max_price_concession_bps,'price concession',1000);
  return v;
}
export function createSettingsStore(db){
  db.exec('CREATE TABLE IF NOT EXISTS user_settings (version TEXT PRIMARY KEY, effective_at TEXT NOT NULL, record TEXT NOT NULL)');
  const hash=x=>createHash('sha256').update(x).digest('hex');
  function save(value,expectedVersion){
    if(expectedVersion&&current().version!==expectedVersion)throw new Error('Settings changed. Reload before saving.');
    const settings=validateSettings(value),effective_at=new Date().toISOString(),version=hash(JSON.stringify(settings)+effective_at);
    db.prepare('INSERT INTO user_settings VALUES (?,?,?)').run(version,effective_at,JSON.stringify(settings));return current();
  }
  function current(){
    const row=db.prepare('SELECT * FROM user_settings ORDER BY rowid DESC LIMIT 1').get();
    if(!row)return save(defaultSettings());
    const settings=validateSettings(JSON.parse(row.record)),rules_text=readFileSync(rulesPath,'utf8'),rule_mtime=statSync(rulesPath).mtime.toISOString();
    return {version:hash(row.version+rules_text),effective_at:row.effective_at>rule_mtime?row.effective_at:rule_mtime,source:'local rules.md and validated SQLite settings',settings,rules_text,approval_required:true,missed_call_reduction_exception:true,automatic_execution:false,adds_enabled:settings.allowed_actions.includes('add')&&settings.spending_limits_usd.add>0,missing_configuration:[...(!settings.spending_limits_usd.add?['Set an add spending limit to enable adds']:[]),...cryptoSymbols.filter(s=>Object.values(settings.crypto_loss_thresholds[s]).every(v=>v===null)).map(s=>'Set '+s+' loss dollars or percent'),...(Object.values(settings.sports_loss_thresholds).every(v=>v===null)?['Set sports contract-price points or dollar loss threshold']:[]),...(settings.alert_cooldown_minutes===null?['Set an alert cooldown']:[])],units:{crypto:'Alpaca unrealized loss in dollars or percent; not contract points',sports:'1 contract-price point = $0.01 per contract; dollars refer to contract position loss'},notice:'Answered calls need exact approval. The first verified unanswered call allows covered reductions under complete active rules. Adds always need exact approval and a spending cap. Quiet hours and notes alone never authorize an order.'};
  }
  return {current,save};
}

export function reductionPolicy(ur){
  const s=ur.settings,r=s.missed_call_reductions,rules=[];
  for(const symbol of cryptoSymbols){
    const target=r.crypto_target_pct[symbol],t=s.crypto_loss_thresholds[symbol];
    if(!target||!s.allowed_actions.includes(target===100?'close':'trim'))continue;
    for(const [unit,metric] of [['dollars','unrealized_pl'],['percent','unrealized_pl_percent']])if(t[unit])rules.push({id:symbol+'-'+unit,symbol,target_reduction_pct:target,all:[{metric,op:'lte',value:-t[unit]}]});
  }
  return {enabled:r.enabled&&s.alert_cooldown_minutes>0,account:'alpaca-paper',version:ur.version,effective_at:ur.effective_at,timezone:'America/Los_Angeles',start:'22:30',end:'06:30',quiet_hours:s.quiet_hours,alert_cooldown_minutes:s.alert_cooldown_minutes,spending_limits_usd:s.spending_limits_usd,missed_call_fallback:true,symbols:[...new Set(rules.map(r=>r.symbol))],max_slippage_bps:r.max_price_concession_bps,rules};
}
