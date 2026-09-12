import { config } from './config.mjs';
import { json } from './providers.mjs';
import { datetimeTool } from './authority.mjs';

export async function decide({authority,policy,evidence,eligible,position}) {
  if (!config.OPENROUTER_MODEL||!config.OPENROUTER_API_KEY) throw new Error('Selected model unavailable');
  const started=Date.now();
  const response=await json('https://openrouter.ai/api/v1/chat/completions',{method:'POST',signal:AbortSignal.timeout(20000),headers:{Authorization:`Bearer ${config.OPENROUTER_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({
    model:config.OPENROUTER_MODEL,reasoning:{effort:config.OPENROUTER_REASONING_EFFORT||'low'},max_tokens:1000,tools:[datetimeTool],
    messages:[{role:'system',content:`You are Night Desk's risk executor. Demo/paper only. ${authority.instruction} CURRENT SERVER AUTHORITY: ${JSON.stringify(authority)}. This is preauthorized autonomous mode, not a phone conversation. You decide whether to apply one of the eligible rules or hold. Never ask for a phone confirmation. Every condition in a rule must be satisfied; unrealized_pl and unrealized_pl_percent are Alpaca account P&L; return_1m and return_5m use completed Coinbase candles for THIS symbol. Volume alone does not establish price direction or predict future prices. Rules define cumulative reductions from the Pacific 22:30-to-22:30 risk cycle's first observed position, not repeated percentages of the remainder. Do not invent thresholds, market facts, order fills or email delivery. You cannot change policy. Return ONLY JSON: {"action":"reduce"|"hold","rule_id":string|null,"reason":string}. For reduce, select an eligible rule ID. Choose the highest satisfied reduction if warranted; otherwise explain hold. The backend rechecks evidence and time before execution.`},
      {role:'user',content:JSON.stringify({policy,evidence,eligible_rules:eligible,position})}]
  })});
  const content=response.choices?.[0]?.message?.content;
  if(typeof content!=='string') throw new Error('No model decision');
  const decision=JSON.parse(content.replace(/^\s*```(?:json)?\s*/,'').replace(/\s*```\s*$/,''));
  if(!['reduce','hold'].includes(decision.action)||typeof decision.reason!=='string'||!decision.reason.trim()||decision.reason.length>2000) throw new Error('Invalid model decision');
  if(decision.action==='reduce'&&!eligible.some(r=>r.id===decision.rule_id)) throw new Error('Model selected an unauthorized rule');
  return {...decision,model:response.model,provider:response.provider,usage:response.usage,latency_ms:Date.now()-started};
}
