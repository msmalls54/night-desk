import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createContext,SourceTextModule,SyntheticModule} from 'node:vm';
import * as web from '../src/web-search.mjs';
let requests=[],queue=[];
const exact='Alpaca paper: Trim 5 percent of your BTC holding by selling 0.015435981 coins with one market order. Do you approve this exact action?';
const context=createContext({Date,Intl,JSON,Object,AbortSignal});
const deps={
  './config.mjs':{config:{OPENROUTER_MODEL:'configured-gemini',OPENROUTER_API_KEY:'mock'}},
  './providers.mjs':{json:async(_url,options)=>{requests.push(JSON.parse(options.body));return queue.shift();}},
  './gate.mjs':{propose:()=>exact},
  './position-actions.mjs':{proposePositionAction:call=>{call.pending={readback:exact};return exact;}},
  './memory.mjs':{memory:()=>({}),remember:()=>({})},
  './authority.mjs':{datetimeTool:{type:'openrouter:datetime'}},
  './web-search.mjs':web
};
const module=new SourceTextModule(readFileSync(new URL('../src/brain.mjs',import.meta.url),'utf8'),{context});
await module.link(s=>new SyntheticModule(Object.keys(deps[s]),function(){for(const[k,v]of Object.entries(deps[s]))this.setExport(k,v);},{context}));await module.evaluate();
const symbols=['BTCUSD','ETHUSD','SOLUSD','XRPUSD','DOGEUSD'];
const positions=symbols.map((symbol,i)=>({symbol,qty:String(i+1)+'.123456789',market_value:String(77502+i),unrealized_pl:String(-i),quote:{bid:100+i,at:'2026-09-12T21:00:00Z',fresh:true}}));
const products=Object.fromEntries(symbols.map((symbol,i)=>[symbol,{product_id:symbol.replace('USD','-USD'),source:'Coinbase '+symbol,volume_label:'Completed minute volume relative to previous twenty completed minutes',at:'2026-09-12T21:00:00Z',candle_at:'2026-09-12T20:59:00Z',fresh:true,contiguous:true,return_1m:i+0.1,return_5m:i+0.5,volume_ratio_20m:i+1,unavailable_reasons:[]}]));
function call(text){return{call_id:'mock',context:{alpaca:{positions,at:'2026-09-12T21:00:00Z'},coinbase:{products},kalshi:{positions:[{ticker:'MOCK-UNT',position_fp:'4.17'},{ticker:'MOCK-UNM',position_fp:'-1.00'}]},football:{game:{event_ticker:'KXNCAAFGAME-26SEP12UNCOWYO'}},user_rules:{test_hold:true}},transcript:[{role:'user',content:text}],tool_calls:[]};}
const toolCalls=names=>({choices:[{message:{tool_calls:names.map(name=>({id:name,function:{name,arguments:'{}'}}))}}]});
for(const symbol of symbols.slice(1)){
  requests=[];queue=[toolCalls(['get_position','get_quote','get_indicators']),{choices:[{message:{content:'Mock explanation.'}}]}];await module.namespace.brain(call('Tell me about my '+symbol+' holding and indicators'));
  const result=id=>JSON.parse(requests[1].messages.find(m=>m.tool_call_id===id).content);
  assert.equal(result('get_position').alpaca.positions.find(p=>p.symbol===symbol).qty,positions.find(p=>p.symbol===symbol).qty);
  assert.equal(result('get_quote').alpaca_quotes.find(p=>p.symbol===symbol).quote.bid,positions.find(p=>p.symbol===symbol).quote.bid);
  assert.equal(result('get_indicators').products[symbol].return_5m,products[symbol].return_5m);
  assert.equal(result('get_indicators').products[symbol].product_id,products[symbol].product_id);
  assert.equal(result('get_indicators').products[symbol].volume_label,products[symbol].volume_label);
  assert.equal(result('get_position').kalshi.positions[1].position_fp,'-1.00');
  assert.equal(requests[0].tools.some(t=>t.type==='openrouter:web_search'),false);
}
products.BTCUSD.return_1m=-0.001412757616037208;products.BTCUSD.return_5m=-0.07980356046655146;products.ETHUSD.return_5m=-0.07083021719948013;
products.BTCUSD.price=77502;
requests=[];queue=[toolCalls(['get_indicators','get_quote']),{choices:[{message:{content:'Mock corrected percentage explanation.'}}]}];await module.namespace.brain(call('What are my Bitcoin and Ethereum indicators?'));
for(const name of ['get_indicators','get_quote']){
  const data=JSON.parse(requests[1].messages.find(m=>m.tool_call_id===name).content);
  const snapshot=name==='get_quote'?data.coinbase:data;
  assert.equal(snapshot.products.BTCUSD.metrics.return_1m.display,'-0.0014%');
  assert.equal(snapshot.products.BTCUSD.metrics.return_1m.spoken,'down 0.0014 percent');
  assert.equal(snapshot.products.BTCUSD.metrics.return_5m.display,'-0.0798%');
  assert.equal(snapshot.products.BTCUSD.metrics.return_5m.spoken,'down 0.0798 percent');
  assert.equal(snapshot.products.ETHUSD.metrics.return_5m.display,'-0.0708%');
  assert.equal(snapshot.products.BTCUSD.return_5m,-0.07980356046655146);
  assert.equal(snapshot.products.BTCUSD.metrics.return_5m.unit,'percent');
  assert.equal(snapshot.products.BTCUSD.metrics.volume_ratio_20m.unit,'ratio');
  assert.equal(snapshot.products.BTCUSD.metrics.volume_ratio_20m.display,'1×');
  assert.ok(snapshot.units.return_5m.includes('NEVER multiply again'));
  if(name==='get_quote')assert.equal(snapshot.products.BTCUSD.price,77502);
}
assert.ok(requests[0].messages[0].content.includes('NEVER multiply them by 100'));
assert.ok(requests[0].messages[0].content.includes('correct it explicitly'));
assert.ok(requests[0].messages[0].content.includes('Never expand ticker abbreviations into guessed team names'));
assert.ok(requests[0].messages[0].content.includes('negative signed Kalshi position is owned NO contracts, not a short sale'));
products.DOGEUSD.contiguous=false;products.DOGEUSD.unavailable_reasons=['Exact one-minute candle gap','Twenty-minute baseline unavailable'];
requests=[];queue=[toolCalls(['get_indicators','get_position']),{choices:[{message:{content:'Mock missing-indicator explanation.'}}]}];await module.namespace.brain(call('What are my Dogecoin indicators?'));
const doge=JSON.parse(requests[1].messages.find(m=>m.tool_call_id==='get_indicators').content).products.DOGEUSD;
assert.equal(doge.return_1m,null);assert.equal(doge.return_5m,null);assert.equal(doge.volume_ratio_20m,null);assert.deepEqual(doge.unavailable_reasons,products.DOGEUSD.unavailable_reasons);assert.equal(doge.available,false);assert.equal(doge.metrics.return_5m.display,'unavailable');
assert.ok(JSON.parse(requests[1].messages.find(m=>m.tool_call_id==='get_position').content).alpaca.positions.some(p=>p.symbol==='DOGEUSD'));
const prompt=requests[0].messages[0].content;assert.ok(prompt.includes('seventy-seven thousand five hundred two dollars'));assert.ok(prompt.includes('never seven seven five zero two'));assert.ok(prompt.includes('never rewrite, round, spell out or otherwise transform the exact server-generated action proposal/readback'));assert.ok(prompt.includes('Wyoming game facts must never be attributed to UNT, UNM or another matchup'));assert.ok(prompt.includes('only their explicitly configured scope can authorize it'));
const proposal=call('Trim five percent');queue=[{choices:[{message:{tool_calls:[{id:'proposal',function:{name:'propose_position_action',arguments:'{"venue":"alpaca-paper","symbol":"BTCUSD","action":"trim","pct":5,"order_type":"market"}'}}]}}]}];const reply=await module.namespace.brain(proposal);assert.equal(reply.text,exact);assert.equal(proposal.pending.readback,exact);
console.log('PASS: distinct ETH/SOL/XRP/DOGE holdings, quotes and three indicators; missing DOGE data explained without hiding holding; dynamic YES/NO sports inventory; spoken-dollar prompt and exact untouched proposal binding. All model/tool responses mocked; no handset or pronunciation claim.');
