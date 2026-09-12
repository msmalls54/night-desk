import {createHash} from 'node:crypto';
import {config} from './config.mjs';
import {clockContext,policyHash} from './authority.mjs';

// A controlled owner call established this signed reason
// and the matching carrier greeting. The owner reported ringing then voicemail.
// Unknown greetings, forwarded conversational turns and generic failures stay held.
const verifiedNoAnswerReasons = new Set(['voicemail_reached']);
export const callerWords = text => String(text||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const verifiedCarrierGreeting=callerWords("Your call has been forwarded to voicemail. The person you're trying to reach is not available. At the tone, please record your message. When you have finished recording, you may hang up.");
const endCallerWords=d=>callerWords((d.transcript||[]).filter(t=>t.role==='user').map(t=>t.content||'').join(' '));
export function buildRiskCallRequest(greeting,settings=config) {
  if(!settings.AGENTPHONE_AGENT_ID||!settings.AGENTPHONE_NUMBER_ID||!/^\+[1-9]\d{7,14}$/.test(settings.MY_PHONE||''))throw new Error('Owner call configuration is incomplete');
  if(typeof greeting!=='string'||!greeting.trim()||greeting.length>1000)throw new Error('Risk call greeting is invalid');
  // These fields are documented by AgentPhone's CreateOutboundCallRequest.
  // In particular, never include systemPrompt: our webhook owns the model/tools.
  return {agentId:settings.AGENTPHONE_AGENT_ID,fromNumberId:settings.AGENTPHONE_NUMBER_ID,toNumber:settings.MY_PHONE,initialGreeting:greeting,disableRecording:true};
}
async function phone(path,options={}) {
  const r=await fetch('https://api.agentphone.ai/v1'+path,{...options,headers:{Authorization:`Bearer ${config.AGENTPHONE_API_KEY}`,'Content-Type':'application/json'},signal:AbortSignal.timeout(15000)});
  if(!r.ok)throw new Error('AgentPhone HTTP '+r.status);
  return r.json();
}
export const phoneAdapter={
  ready:()=>verifiedNoAnswerReasons.size>0&&!!config.AGENTPHONE_API_KEY&&!!config.AGENTPHONE_AGENT_ID&&!!config.MY_PHONE&&!!config.AGENTPHONE_NUMBER_ID,
  isNoAnswer:d=>verifiedNoAnswerReasons.has(d.disconnectionReason)&&d.status==='completed'&&Array.isArray(d.transcript)&&endCallerWords(d)===verifiedCarrierGreeting,
  noHumanConversation:text=>text===verifiedCarrierGreeting,
  create:async({greeting})=>phone('/calls',{method:'POST',body:JSON.stringify(buildRiskCallRequest(greeting))}),
  read:id=>phone('/calls/'+encodeURIComponent(id))
};

export function createRiskCalls({db,now=()=>new Date(),adapter=phoneAdapter,ownerPhone=config.MY_PHONE,agentId=config.AGENTPHONE_AGENT_ID,onCreated=()=>{},onEvent=()=>{}}) {
  db.exec('CREATE TABLE IF NOT EXISTS risk_calls (id TEXT PRIMARY KEY, record TEXT NOT NULL)');
  const all=()=>db.prepare('SELECT record FROM risk_calls ORDER BY rowid DESC').all().map(r=>JSON.parse(r.record));
  const save=a=>db.prepare('INSERT OR REPLACE INTO risk_calls VALUES (?,?)').run(a.id,JSON.stringify(a));
  const matching=id=>all().find(a=>a.call_id===id);
  function status(){return {requested:true,provider_verified:adapter.ready(),state:adapter.ready()?'verified_carrier_voicemail':'awaiting_verified_no_answer_outcome',message:adapter.ready()?'Covered reductions may follow the first verified carrier voicemail with no human conversation. Unknown or failed calls remain held.':'Missed-call outcome is unverified; automatic calls/actions are held.',calls:all().slice(0,20)};}
  function observe(payload) {
    const d=payload.data||{},a=matching(d.callId);
    if(!a||payload.agentId!==agentId||payload.channel!=='voice'||d.direction!=='outbound'||d.to!==ownerPhone)return;
    // Called only after the server verifies the provider signature. A voice turn
    // latches interaction, including voicemail/screening: none is a missed-call grant.
    if(payload.event==='agent.message'){a.interaction=true;a.state='interaction';save(a);}
    if(payload.event==='agent.call_ended'){a.end=d;a.state=a.interaction?'interaction':'ended';save(a);}
  }
  async function ensure({policy,position,evidence,eligible,cycle,greeting}) {
    if(!adapter.ready()||!policy.missed_call_fallback)return null;
    const time=clockContext(now()).pacific.slice(11,16),quiet=policy.quiet_hours;
    if(quiet&&quiet.start!==quiet.end&&(quiet.start<quiet.end?time>=quiet.start&&time<quiet.end:time>=quiet.start||time<quiet.end))return null;
    const id='risk-'+createHash('sha256').update(cycle+':'+position.symbol+':'+policyHash(policy)).digest('hex').slice(0,32);
    let a=all().find(a=>a.id===id);
    if(!a){
      // One attempt per symbol/policy/cycle. An ambiguous POST is never retried.
      a={id,cycle,symbol:position.symbol,policy_hash:policyHash(policy),rule_ids:eligible.map(r=>r.id),position,evidence,created_at:now().toISOString(),state:'creating',attempt:1};
      if(!db.prepare('INSERT OR IGNORE INTO risk_calls VALUES (?,?)').run(id,JSON.stringify(a)).changes)return null;
      try {
        const coin=position.symbol==='BTCUSD'?'Bitcoin':position.symbol.replace('USD','');
        const r=await adapter.create({greeting:greeting??`Hi ${config.OWNER_NAME||'there'}, this is Night Desk. Your ${coin} loss rule has triggered. I have your position and the latest price and volume readings ready. What would you like to know?`});
        if(typeof r.id!=='string'||!r.id)throw new Error('Call creation ID unverified');
        a.call_id=r.id;a.state='calling';save(a);onCreated(a);onEvent('risk_call_started',{id,call_id:a.call_id,symbol:a.symbol});
      } catch {a.state='creation_unverified';save(a);}
      return null;
    }
    if(!a.call_id||a.interaction||!a.end)return null;
    const end=a.end,age=now().getTime()-Date.parse(end.endedAt);
    if(!Number.isFinite(age)||age<0||age>600000||Date.parse(end.endedAt)<Date.parse(a.created_at)||!adapter.isNoAnswer(end))return null;
    const nonHuman=adapter.noHumanConversation||((text)=>text==='');
    if(!Array.isArray(end.transcript)||!nonHuman(endCallerWords(end)))return null;
    const r=await adapter.read(a.call_id);
    if(r.id!==a.call_id||r.agentId!==agentId||r.toNumber!==ownerPhone||r.direction!=='outbound'||!['completed','failed'].includes(r.status)||r.status!==end.status||r.endedAt!==end.endedAt||!Array.isArray(r.transcripts))return null;
    const readWords=callerWords(r.transcripts.map(t=>t.transcript||'').join(' '));
    if(!nonHuman(readWords)||readWords!==endCallerWords(end))return null;
    a.state='verified_no_answer';a.verified_at=now().toISOString();save(a);
    return grant(a,policy,position.symbol,cycle);
  }
  function grant(a,policy,symbol,cycle) {
    const age=now().getTime()-Date.parse(a?.end?.endedAt);
    if(!a||a.state!=='verified_no_answer'||a.interaction||!policy.missed_call_fallback||a.policy_hash!==policyHash(policy)||a.symbol!==symbol||a.cycle!==cycle||!Number.isFinite(age)||age<0||age>600000)return null;
    return {call_id:a.call_id,symbol,cycle,policy_hash:a.policy_hash,rule_ids:a.rule_ids,expires_at:new Date(Date.parse(a.end.endedAt)+600000).toISOString(),reason:'first_call_unanswered'};
  }
  return {status,observe,ensure,grant:(id,p,s,c)=>grant(matching(id),p,s,c)};
}
