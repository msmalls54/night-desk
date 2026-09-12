import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {phoneAdapter,createRiskCalls} from '../src/risk-calls.mjs';
import {clockContext} from '../src/authority.mjs';
const recorded={id:'synthetic-voicemail',agentId:'synthetic-agent',toNumber:'+15555550123',direction:'outbound',status:'completed',endedAt:'2026-09-12T20:13:02Z',transcripts:[{transcript:"Your call has been forwarded to voicemail. The person you're trying to reach is not available. At the tone, please record your message. When you have finished recording, you may hang up."}]};
const transcript=recorded.transcripts.map(t=>({role:'user',content:t.transcript}));
const data={callId:recorded.id,status:'completed',disconnectionReason:'voicemail_reached',endedAt:recorded.endedAt,transcript};
assert.equal(phoneAdapter.isNoAnswer(data),true);
for(const d of [{...data,disconnectionReason:'failed'},{...data,status:'failed'},{...data,transcript:[]},{...data,transcript:[...transcript,{role:'user',content:'Hello, this is Mike. Do not trade.'}]},{...data,transcript:[{role:'user',content:'Please leave me a message'}]}])assert.equal(phoneAdapter.isNoAnswer(d),false);
async function check({humanTurn=false,mismatch=false}={}){
  const db=new DatabaseSync(':memory:');let time=new Date('2026-09-12T20:12:17Z'),calls=0;
  const policy={version:'voicemail-fixture',missed_call_fallback:true},position={symbol:'BTCUSD'},eligible=[{id:'btc-demo'}],cycle=clockContext(time).risk_cycle_id;
  const provider={...recorded,...(mismatch?{transcripts:[{transcript:'Human speech'}]}:{})};
  const risk=createRiskCalls({db,now:()=>time,ownerPhone:recorded.toNumber,agentId:recorded.agentId,adapter:{...phoneAdapter,ready:()=>true,create:async()=>{calls++;return{id:recorded.id}},read:async()=>provider}});
  assert.equal(await risk.ensure({policy,position,evidence:{},eligible,cycle}),null);
  if(humanTurn)risk.observe({event:'agent.message',channel:'voice',agentId:recorded.agentId,data:{callId:recorded.id,to:recorded.toNumber,direction:'outbound',transcript:'hello'}});
  risk.observe({event:'agent.call_ended',channel:'voice',agentId:recorded.agentId,data:{...data,to:recorded.toNumber,direction:'outbound'}});
  time=new Date('2026-09-12T20:13:05Z');
  const grant=await risk.ensure({policy,position,evidence:{},eligible,cycle});assert.equal(!!grant,!humanTurn&&!mismatch);assert.equal(calls,1);db.close();
}
await check();await check({humanTurn:true});await check({mismatch:true});
console.log('PASS: observed carrier voicemail requires exact automated greeting, matching signed-event/provider transcript, owner/agent/call/time identity, and no forwarded human conversation. Empty/unknown voicemail, generic failure, altered transcript and human turns remain held. Synthetic fixtures and injected providers only; zero new calls/trades/emails.');
