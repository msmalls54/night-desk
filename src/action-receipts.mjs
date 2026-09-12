import {composeReceipt} from './receipt-writer.mjs';
import {sendEmail} from './overnight-providers.mjs';
export function createActionReceipts(actions,{write=composeReceipt,send=sendEmail}={}){
  let busy=false;
  return async function tick(){
    if(busy)return;busy=true;
    try{for(const prior of actions.all()){
      if(!['pending','unknown','terminal','submitting'].includes(prior.state))continue;
      const r=await actions.reconcile(prior);
      if(!r||r.state==='pending')continue;
      const stage=r.state==='terminal'?'final':'unverified';
      r.email||={};if(r.email[stage])continue;
      r.email[stage]={status:'writing',at:new Date().toISOString()};actions.save(r);
      const marketOrder=r.venue==='alpaca-paper'&&(r.request?.type||r.order_type)==='market';
      const pricing=marketOrder?'This was a market order with no guaranteed fill price. Report an actual fill price only if the provider verified it; never substitute the earlier quote.':'This was a limit order. Preserve the approved limit and report only the verified fill outcome; execution was not guaranteed.';
      const marketContext=r.venue==='alpaca-paper'?r.context?.coinbase?.products?.[r.symbol]:r.context?.football?.game;
      const facts={purpose:'Explain this owner-approved paper/demo position action in plain English. It followed an exact approved proposal; do not invent a rule trigger or investment advantage. Discuss only context relevant to the traded asset. Do not promise continued monitoring or future authority.',pricing_explanation:pricing,order_type:marketOrder?'market':'limit',approved_readback:r.readback,rule_version:r.rule_version,approval:r.approval,venue:r.venue,symbol:r.symbol,action:r.action,request:r.request,order:r.order||null,state:r.state,maximum_budget:r.spend_usd,context_at:r.context_at,market_context:marketContext?{...marketContext,...(r.venue==='alpaca-paper'?{return_units:'return_1m and return_5m are already percentage values; never multiply by 100. Volume ratio is a multiple, not percent.'}:{})}:null};
      let draft;
      try{draft=await write(facts);}catch(e){r.receipt_writing_error=e.message;draft={subject:'Night Desk — paper/demo order update',text:`Your approved ${r.action} for ${r.symbol} is ${r.order?.status||r.state}. ${r.order?'The provider reports '+r.order.filled_qty+' filled.':'The outcome is unverified; I will not repeat the order.'}\n\nThis followed the exact proposal you approved. ${marketOrder?'A market order has no guaranteed fill price.':'A limit order may fill partly or not at all.'} This is paper/demo money.`};}
      r.email[stage]={...r.email[stage],status:'sending',draft};actions.save(r);
      try{const sent=await send(draft);if(!sent?.message_id)throw new Error('No acceptance reference');r.email[stage]={...r.email[stage],status:'accepted',message_id:sent.message_id};}
      catch{r.email[stage]={...r.email[stage],status:'unverified',error:'Reconcile email provider before any retry'};}
      actions.save(r);
    }}finally{busy=false;}
  };
}
