import { createHash, randomUUID } from 'node:crypto';
import { authority, eligibleRules, loadPolicy, policyHash } from './authority.mjs';
import { buildOrder, verifiedOrder, terminalStatuses, overnightReceipt,units } from './overnight-orders.mjs';
import * as realAdapters from './overnight-providers.mjs';
import { decide as realDecide } from './overnight-decision.mjs';

export function createOvernightWorker({db,getPolicy=loadPolicy,refreshPolicy=async()=>{},now=()=>new Date(),adapters=realAdapters,decide=realDecide,narrate=async(a,s,d)=>d,riskCalls=null,onEvent=()=>{}}) {
  db.exec(`CREATE TABLE IF NOT EXISTS overnight_actions (id TEXT PRIMARY KEY, record TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS overnight_nights (id TEXT PRIMARY KEY, record TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS overnight_meta (key TEXT PRIMARY KEY, record TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS overnight_lock (id INTEGER PRIMARY KEY, owner TEXT, expires INTEGER NOT NULL);`);
  const owner=randomUUID();let busy=false,timer;
  const get=(table,key)=>{const row=db.prepare(`SELECT record FROM ${table} WHERE ${table==='overnight_meta'?'key':'id'}=?`).get(key);return row?JSON.parse(row.record):null;};
  const put=(table,key,value)=>db.prepare(`INSERT OR REPLACE INTO ${table} VALUES (?,?)`).run(key,JSON.stringify(value));
  const actions=()=>db.prepare('SELECT record FROM overnight_actions ORDER BY rowid DESC').all().map(r=>JSON.parse(r.record));
  const save=a=>put('overnight_actions',a.id,a);
  function status() {return {...authority(getPolicy(),now()),missed_call_fallback:riskCalls?.status()||null,worker:get('overnight_meta','status'),actions:actions().slice(0,30)};}
  const ownsLock=()=>!!db.prepare('SELECT id FROM overnight_lock WHERE id=1 AND owner=? AND expires>?').get(owner,now().getTime());
  function lock() {
    return db.prepare(`INSERT INTO overnight_lock VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,expires=excluded.expires WHERE overnight_lock.expires<=?`).run(owner,now().getTime()+300000,now().getTime()).changes===1;
  }
  async function email(a,stage) {
    a.email ||= {};
    if(a.email[stage]) return; // Ambiguous sends are held for readback, never blindly repeated.
    let draft=a.receipt_narratives?.[stage]||overnightReceipt(a,stage);
    if(!a.receipt_narratives?.[stage])try{
      draft=await narrate(a,stage,draft);a.receipt_narratives||={};a.receipt_narratives[stage]=draft;save(a);
    }catch(e){a.receipt_writing_error=e.message;save(a);}
    a.email[stage]={status:'sending',at:now().toISOString(),draft};save(a);
    try {
      const r=await adapters.sendEmail(draft);
      if(!r?.message_id) throw new Error('No email acceptance receipt');
      a.email[stage]={...a.email[stage],status:'accepted',message_id:r.message_id,thread_id:r.thread_id};save(a);
      onEvent('overnight_email_accepted',{action_id:a.id,stage,message_id:r.message_id});
    } catch {a.email[stage]={...a.email[stage],status:'unverified',error:'Email acceptance unverified; reconcile before retry'};save(a);onEvent('overnight_email_unverified',{action_id:a.id,stage});}
  }
  async function reconcile(a) {
    if(a.state!=='terminal')try {
      const result=await adapters.findOrder(a.request.client_order_id);
      if(result) {a.provider_order=verifiedOrder(result,a.request);a.state=terminalStatuses.has(result.status)?'terminal':'pending';save(a);}
      else {a.state='unknown';save(a);}
    } catch {a.state='unknown';save(a);}
    if(a.state==='terminal') {
      try {const p=(await adapters.positions()).find(p=>p.symbol===a.symbol);a.remaining={qty:p?.qty||'0',at:now().toISOString()};save(a);} catch {}
      await email(a,'final');
    } else if(a.state==='unknown'||now().getTime()-Date.parse(a.created_at)>120000) await email(a,'pending');
  }
  async function tick() {
    if(busy) return;
    busy=true;let acquired=false;
    try {
      acquired=lock();if(!acquired) return;
      // Reconcile already-submitted orders even after 6:30 AM or a policy pause.
      for(const a of actions().filter(a=>a.state!=='terminal'||!a.email?.final)) {if(!ownsLock())return;await reconcile(a);}
      await refreshPolicy();
      const policy=getPolicy(),auth=authority(policy,now());
      put('overnight_meta','status',{at:now().toISOString(),state:auth.state});
      if(!auth.ready||(!auth.final_authority&&(!policy.missed_call_fallback||!riskCalls?.status().provider_verified))) return;
      if(!adapters.ready()) throw new Error('Model, paper account or receipt configuration incomplete');
      const positions=await adapters.positions();
      for(const position of positions.filter(p=>policy.symbols.includes(p.symbol))) {
        if(!ownsLock()||!authority(getPolicy(),now()).ready||policyHash(getPolicy())!==policyHash(policy)) return;
        const existing=actions();
        if(existing.some(a=>a.symbol===position.symbol&&a.state!=='terminal')) continue;
        const cycle=auth.risk_cycle_id;
        const baselineId=cycle+':'+position.symbol;
        let baseline=get('overnight_nights',baselineId);
        const demoScope=policy.demo_scope,demoScopeHash=demoScope?policyHash(demoScope):null;
        if(baseline&&demoScope&&(baseline.demo_scope_hash!==demoScopeHash||baseline.demo_policy_hash!==policyHash(policy)||units(baseline.qty)!==units(demoScope.baseline_qty)))throw new Error('Crypto demo ID was reused with changed scope, rules or baseline');
        if(!baseline){baseline={qty:demoScope?String(demoScope.baseline_qty):position.qty,at:now().toISOString(),...(demoScope?{demo_scope_hash:demoScopeHash,demo_policy_hash:policyHash(policy),scope:demoScope}:{})};put('overnight_nights',baselineId,baseline);}
        const evidence=await adapters.indicators(position.symbol,position);
        put('overnight_meta','evidence:'+position.symbol,evidence);
        const idFor=r=>'nd-'+createHash('sha256').update(cycle+':'+position.symbol+':'+JSON.stringify(r)).digest('hex').slice(0,32);
        let eligible=eligibleRules(policy,evidence,now()).filter(r=>!get('overnight_actions',idFor(r)));
        if(!eligible.length) continue;
        let grant=null;
        if(!auth.final_authority){
          // Refresh immediately before a possible outbound call as well as an order.
          await refreshPolicy({allowCompile:false});
          if(!ownsLock()||!authority(getPolicy(),now()).ready||policyHash(getPolicy())!==policyHash(policy)||!eligibleRules(policy,evidence,now()).length)return;
          grant=await riskCalls.ensure({policy,position,evidence,eligible,cycle});
          if(!grant)continue;
          eligible=eligible.filter(r=>grant.rule_ids.includes(r.id));
          if(!eligible.length)continue;
        }
        const decisionAuthority=authority(policy,now(),'overnight-worker',grant);
        if(!decisionAuthority.final_authority||decisionAuthority.risk_cycle_id!==cycle)continue;
        const reviewKey='review:'+cycle+':'+position.symbol+':'+eligible.map(idFor).sort().join(',');
        const lastReview=get('overnight_meta',reviewKey);
        // Cool down unchanged breaches; a new severity tier or reviewed version gets a fresh turn.
        if(lastReview&&now().getTime()-Date.parse(lastReview.at)<(policy.alert_cooldown_minutes||5)*60000)continue;
        put('overnight_meta',reviewKey,{at:now().toISOString(),status:'requested'});
        const decision=await decide({authority:decisionAuthority,policy,evidence,eligible,position});
        put('overnight_meta',reviewKey,{at:now().toISOString(),decision});
        onEvent('overnight_decision',{symbol:position.symbol,action:decision.action,rule_id:decision.rule_id});
        if(decision.action!=='reduce')continue;
        const rule=eligible.find(r=>r.id===decision.rule_id);
        if(!rule||typeof decision.reason!=='string'||!decision.reason.trim())throw new Error('Unauthorized model decision');
        const flight=await adapters.preflight(position.symbol);
        const flightAge=now().getTime()-Date.parse(flight.at),quoteAge=now().getTime()-Date.parse(flight.quote?.at);
        if(!Number.isFinite(flightAge)||flightAge<0||flightAge>15000||!Number.isFinite(quoteAge)||quoteAge<0||quoteAge>15000){
          // No order was attempted: a stale quote is not a completed review or
          // a new alert. Keep the one call and retry fresh preflight next tick.
          db.prepare('DELETE FROM overnight_meta WHERE key=?').run(reviewKey);
          onEvent('reduction_waiting_for_fresh_quote',{symbol:position.symbol});continue;
        }
        if(String(flight.position.avg_entry_price)!==String(position.avg_entry_price))throw new Error('Position entry changed during decision');
        await refreshPolicy({allowCompile:false});
        const latestGrant=grant?riskCalls.grant(grant.call_id,getPolicy(),position.symbol,cycle):null;
        const check=authority(getPolicy(),now(),'overnight-worker',latestGrant);
        if(!ownsLock()||!check.final_authority||check.risk_cycle_id!==cycle||check.policy_hash!==policyHash(policy))return;
        if(!latestGrant||!latestGrant.rule_ids.includes(rule.id))return;
        if(!eligibleRules(policy,evidence,now()).some(r=>r.id===rule.id))continue;
        const filled=actions().filter(a=>a.night_id===cycle&&a.symbol===position.symbol).map(a=>a.provider_order?.filled_qty||'0');
        const request=buildOrder({policy,rule,baseline,filled,preflight:flight,clientId:idFor(rule),now:now()});
        if(!request)continue;
        const dollarCap=policy.spending_limits_usd?.[rule.target_reduction_pct===100?'close':'trim'];
        if(dollarCap!=null&&units(request.qty)*units(request.limit_price)/units('1')>units(dollarCap))throw new Error('Reduction exceeds the configured action dollar limit');
        const a={id:request.client_order_id,night_id:cycle,symbol:position.symbol,created_at:now().toISOString(),state:'submitting',authority:check,policy,rule,baseline,evidence,decision,request};
        // The durable unique claim comes before the network POST, including after restarts.
        if(!db.prepare('INSERT OR IGNORE INTO overnight_actions VALUES (?,?)').run(a.id,JSON.stringify(a)).changes)continue;
        try {const response=await adapters.submit(request);a.provider_order=verifiedOrder(response,request);a.state=terminalStatuses.has(response.status)?'terminal':'pending';save(a);}
        catch {a.state='unknown';save(a);}
        onEvent('overnight_order',{action_id:a.id,state:a.state,provider_order_id:a.provider_order?.id||null});
        await reconcile(a);
      }
    } catch(e) {put('overnight_meta','status',{at:now().toISOString(),state:'error',error:e.message});onEvent('overnight_error',{error:e.message});}
    finally {if(acquired)db.prepare('DELETE FROM overnight_lock WHERE id=1 AND owner=?').run(owner);busy=false;}
  }
  return {tick,status,start(){if(!timer){void tick();timer=setInterval(()=>void tick(),60000);timer.unref();}},stop(){clearInterval(timer);timer=null;}};
}
