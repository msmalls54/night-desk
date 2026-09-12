import http from 'node:http';
import { Readable } from 'node:stream';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { config, root } from './config.mjs';
import { db, getCall, saveCall, snapshot, getSnapshot, log, recentEvents, recentCalls } from './store.mjs';
import { alpaca, coinbase, kalshi, receipt } from './providers.mjs';
import { newCall, receiveTurn, propose, say } from './gate.mjs';
import { brain } from './brain.mjs';
import { verifySignature, bodyHash } from './webhook.mjs';
import { memory, memoryStatus } from './memory.mjs';
import { authenticated, challenge } from './access.mjs';
import { createOvernightWorker } from './overnight.mjs';
import { setPolicySource,withCryptoDemoScope } from './authority.mjs';
import { createRiskCalls } from './risk-calls.mjs';
import { narrateRiskReceipt,composeReceipt } from './receipt-writer.mjs';
import {sendEmail} from './overnight-providers.mjs';
import {createSportsDemoWorker} from './sports-demo-worker.mjs';
import { football } from './football-context.mjs';
import {createSettingsStore,reductionPolicy} from './user-settings.mjs';
import {createPositionActions} from './position-actions.mjs';
import * as actionAdapters from './action-adapters.mjs';
import {createActionReceipts} from './action-receipts.mjs';
import {ageIndicators} from './crypto-indicators.mjs';
import {cryptoMarketContext} from './crypto-market-context.mjs';
import {interpretApproval} from './approval-intent.mjs';
const port = Number(config.PORT || 8765), uiPort = Number(config.UI_PORT || 8876);
const hosted = config.HOSTED === 'true';
const settings=createSettingsStore(db);
const testRunEnabled=()=>config.DEMO_RUN_ENABLED==='true'&&Date.parse(config.DEMO_RUN_UNTIL)>Date.now();
const policy=()=>{const p=withCryptoDemoScope(reductionPolicy(settings.current()),config.CRYPTO_DEMO_SCOPE_JSON);return {...p,enabled:testRunEnabled()&&p.enabled,test_hold:!testRunEnabled()};};
// Keep historical sheet records, but only current rules.md + validated SQLite
// settings control this context map. No sheet activation can bypass approval.
const ruleSheet={status:()=>({legacy:true,message:'Historical sheet retained; current settings are stored here.'})};
setPolicySource(policy,settings.current);
const riskCalls=createRiskCalls({db,onEvent:log,onCreated:a=>{const c=getCall(a.call_id)||newCall(a.call_id,config.MY_PHONE,{...context(),risk_alert:{symbol:a.symbol,position:a.position,evidence:a.evidence,rule_ids:a.rule_ids,policy_hash:a.policy_hash}});persist(c);}});
const overnight = createOvernightWorker({db,onEvent:log,getPolicy:policy,refreshPolicy:async()=>{},riskCalls,narrate:narrateRiskReceipt});
const actions=createPositionActions({db,getRules:settings.current,adapters:actionAdapters,interpret:interpretApproval,canExecute:testRunEnabled,onUpdate:r=>{
  const call=getCall(r.call_id);if(!call)return;
  call.orders=call.orders.filter(o=>o.action_id!==r.id);
  call.orders.push({action_id:r.id,id:r.order?.id??null,provider_order:!!r.order?.id,venue:r.venue,market:r.symbol,side:r.side,quantity:r.order?.filled_qty??null,price:r.order?.filled_avg_price??null,status:r.order?.status??r.state,email:r.email||null});saveCall(call);
}});
const actionReceipts=createActionReceipts(actions);
const sportsDemo=createSportsDemoWorker({db,riskCalls,getRules:settings.current,getScope:()=>{try{const s=JSON.parse(config.SPORTS_DEMO_CLOSE_JSON||'null');return s?{...s,enabled:testRunEnabled()&&s.enabled===true}:null;}catch{return null;}},narrate:composeReceipt,sendEmail,onEvent:log});
if (hosted && (!config.DATA_DIR || !config.DASHBOARD_TOKEN || config.DASHBOARD_TOKEN.length < 32)) throw new Error('Hosted mode requires persistent DATA_DIR and a strong dashboard token.');
const locks = new Set();
const unavailable = error => ({ unavailable: true, error, at: new Date().toISOString() });
function send(res, status, value) { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); }
async function body(req) {
  const chunks = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > 65536) throw new Error('Body too large'); chunks.push(c); }
  return Buffer.concat(chunks);
}
function context() {
  const result = { at: new Date().toISOString(),test_hold:!testRunEnabled(), memory:memory(),user_rules:{...settings.current(),test_hold:!testRunEnabled()},kalshi_crypto:{unavailable:true,context_only:true,reason:'No verified crypto contract-to-coin mappings configured. These markets never substitute for Alpaca holdings or authorize a contract purchase.'} };
  for (const source of ['alpaca','coinbase','kalshi','football','kalshi_crypto']) {
    const data = getSnapshot(source);
    result[source] = data && { ...data, snapshot_age_seconds: Math.max(0,Math.round((Date.now()-Date.parse(data.at))/1000)) };
    if (source === 'coinbase' && data) {
      const products=Object.fromEntries(Object.entries(data.products||{}).map(([s,p])=>[s,ageIndicators(p)]));
      result[source] = { ...result[source],...ageIndicators(data),products };
    }
    if(source==='alpaca'&&data?.positions){
      result[source].positions=data.positions.map(p=>({...p,quote:{...p.quote,fresh:!!p.quote?.at&&Date.now()-Date.parse(p.quote.at)>=0&&Date.now()-Date.parse(p.quote.at)<=15000}}));
    }
  }
  return result;
}
let refreshing = false;
async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    await Promise.all(Object.entries({ alpaca, coinbase, kalshi, football,kalshi_crypto:()=>cryptoMarketContext(getSnapshot('alpaca')) }).map(async ([name, fn]) => {
      try { const data = await fn(); snapshot(name, data); log('snapshot', { source: name, at: data.at }); }
      catch (e) { snapshot(name, unavailable(e.message)); log('source_unavailable', { source: name, error: e.message }); }
    }));
  } finally { refreshing = false; }
}
function persist(call) { saveCall(call); snapshot('receipt:' + call.call_id, receipt(call)); }
async function ingress(req, res) {
  if (req.method === 'GET' && req.url === '/health') return send(res,200,{ service: 'night-desk', mode:testRunEnabled()?'paper-approval':'demo-test-held', model_configured: !!config.OPENROUTER_MODEL });
  if (req.method !== 'POST' || !['/agentphone/turn','/agentphone/events'].includes(req.url)) return send(res,404,{ error: 'Not found' });
  const raw = await body(req);
  if (!verifySignature(raw, req.headers, config.AGENTPHONE_WEBHOOK_SECRET)) return send(res,401,{ error: 'Invalid signature' });
  const payload = JSON.parse(raw.toString('utf8'));
  if (payload.agentId !== config.AGENTPHONE_AGENT_ID) return send(res,403,{ error: 'Unexpected agent' });
  const hash = bodyHash(raw);
  // The body hash remains stable if a replay changes the unsigned delivery-ID header.
  const id = hash;
  const existing = db.prepare('SELECT * FROM deliveries WHERE id=?').get(id);
  if (existing) return existing.response ? send(res,200,JSON.parse(existing.response)) : send(res,409,{ error: 'Delivery already processing; no action repeated' });
  const d = payload.data || {};
  riskCalls.observe(payload);
  if (locks.has(d.callId)) return send(res,409,{ error: 'Call turn already processing' });
  db.prepare('INSERT INTO deliveries(id,hash) VALUES (?,?)').run(id,hash);
  const finish = response => { db.prepare('UPDATE deliveries SET response=? WHERE id=?').run(JSON.stringify(response),id); return response; };
  log('webhook', { event: payload.event, channel: payload.channel, call_id: d.callId || null });
  if (payload.event === 'agent.call_ended') {
    const peer = d.direction === 'outbound' ? d.to : d.from;
    if (typeof d.callId !== 'string' || !config.MY_PHONE || peer !== config.MY_PHONE) return send(res,200,finish({ok:true}));
    const call = getCall(d.callId) || newCall(d.callId,peer,context());
    if (!call.transcript.length && Array.isArray(d.transcript)) call.transcript=d.transcript.filter(t=>['agent','assistant','user'].includes(t.role)&&typeof t.content==='string').map(t=>({role:t.role==='agent'?'assistant':t.role,content:t.content}));
    call.status = 'ended'; call.pending = null; call.provider_end = d; persist(call);
    return send(res,200,finish({ ok: true }));
  }
  if (payload.event !== 'agent.message' || payload.channel !== 'voice') return send(res,200,finish({ ok: true }));
  if (typeof d.callId !== 'string' || typeof d.transcript !== 'string') return send(res,400,finish({ error: 'Missing voice callId/transcript' }));
  // A valid provider signature authenticates transport, not ownership of the caller.
  const peer = d.direction === 'outbound' ? d.to : d.from;
  if (!config.MY_PHONE || peer !== config.MY_PHONE) return send(res,200,finish({ text: 'This private demo is unavailable for this caller.', hangup: true }));
  // Empty STT output is not a user instruction or a model/API failure.
  if(!d.transcript.trim())return send(res,200,finish({text:'Please repeat that.'}));
  locks.add(d.callId);
  let call = getCall(d.callId) || newCall(d.callId, peer, context(),'paper-confirmation');
  try {
    if (call.status !== 'active') return send(res,200,finish({ text: 'This call has ended.', hangup: true }));
    res.writeHead(200,{ 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' });
    res.write(JSON.stringify({ text: 'One moment.', interim: true }) + '\n');
    // Context is explicitly supplied on each turn; the model cannot see a live
    // dashboard. The proposal's quantity/version remains bound to its readback.
    call.context={...context(),...(call.context.risk_alert?{risk_alert:call.context.risk_alert}:{})};
    if(call.mode==='read-only')call.mode='paper-confirmation';
    const gateReply = call.mode==='simulation'?receiveTurn(call,d.transcript):await actions.receive(call,d.transcript);
    persist(call);
    const reply = gateReply ? { text: gateReply } : /^(goodbye|hang up|bye)[.!?]*$/i.test(d.transcript.trim()) ? { text: 'Goodbye.', hangup: true } : await brain(call);
    const answer = say(call, reply.text, reply.hangup);
    persist(call); finish(answer); res.end(JSON.stringify(answer)+'\n');
    log('voice_turn', { call_id: call.call_id, mode: call.mode, model_configured: !!config.OPENROUTER_MODEL });
  } catch (e) {
    call.pending = null;
    const answer = say(call, 'I could not finish that response. Check the saved order status before trying again; I will not repeat an uncertain order.');
    persist(call); finish(answer); log('turn_failed', { call_id: call.call_id, error: 'Model or turn processing failed' });
    if (res.headersSent) res.end(JSON.stringify(answer)+'\n'); else send(res,200,answer);
  } finally { locks.delete(d.callId); }
}
async function dashboard(req,res) {
  if (hosted) {
    if (!authenticated(req)) return challenge(res);
    if (req.method === 'POST' && req.headers.origin && req.headers.origin !== config.PUBLIC_URL) return send(res,403,{error:'Unexpected origin'});
    if (req.method === 'POST' && !req.headers.origin && !req.headers.authorization?.startsWith('Bearer ')) return send(res,403,{error:'Origin required'});
  } else {
  const allowed = new Set([`localhost:${uiPort}`, `127.0.0.1:${uiPort}`]);
  if (!allowed.has(req.headers.host)) return send(res,403,{ error: 'Local dashboard only' });
  if (req.method === 'POST' && (!req.headers.origin || ![`http://localhost:${uiPort}`,`http://127.0.0.1:${uiPort}`].includes(req.headers.origin))) return send(res,403,{ error: 'Local origin required' });
  if (config.CLOUD_URL && config.DASHBOARD_TOKEN) {
    const target=new URL(req.url,config.CLOUD_URL);
    if (target.origin !== new URL(config.CLOUD_URL).origin) return send(res,400,{error:'Invalid path'});
    const upstream=await fetch(target,{method:req.method,headers:{Authorization:`Bearer ${config.DASHBOARD_TOKEN}`,'Content-Type':'application/json'},...(req.method==='POST'?{body:await body(req)}:{})});
    res.writeHead(upstream.status,{'Content-Type':upstream.headers.get('content-type')||'application/json','Cache-Control':'no-store'});
    if (!upstream.body) return res.end();
    const stream=Readable.fromWeb(upstream.body); stream.on('error',()=>res.end()); res.on('close',()=>stream.destroy()); return stream.pipe(res);
  }
  }
  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200,{ 'Content-Type': 'text/html', 'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'", 'Cache-Control':'no-store' });
    return res.end(readFileSync(path.join(root,'public/index.html')));
  }
  if (req.method === 'GET' && req.url === '/api/state') return send(res,200,{ ...context(), rules_sheet:ruleSheet.status(), overnight:overnight.status(),sports_demo:sportsDemo.status(),position_actions:actions.all().slice(0,20).map(a=>({id:a.id,symbol:a.symbol,action:a.action,state:a.state,order:a.order,email:a.email})), memory_status:memoryStatus(), hosted, model: config.OPENROUTER_MODEL || null, calls: recentCalls().map(c => ({ call_id:c.call_id, mode:c.mode, status:c.status, transcript:c.transcript, orders:c.orders, pending:c.pending, receipt:receipt(c) })), events:recentEvents(), refreshing });
  if(req.method==='POST'&&req.url==='/api/settings'){
    const input=JSON.parse((await body(req)).toString());
    if(typeof input.expected_version!=='string')return send(res,400,{error:'Reload settings before saving'});
    try{const updated=settings.save(input.settings,input.expected_version);log('settings_saved',{version:updated.version});return send(res,200,updated);}catch(e){return send(res,400,{error:e.message});}
  }
  if (req.method === 'GET' && req.url === '/events') {
    res.writeHead(200,{ 'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive' });
    const tick = () => res.write(`data: ${JSON.stringify(recentEvents())}\n\n`);
    tick(); const timer = setInterval(tick,2000); req.on('close',() => clearInterval(timer)); return;
  }
  if (req.method === 'POST' && req.url === '/api/refresh') { await refresh(); return send(res,200,{ok:true}); }
  if (req.method === 'POST' && req.url === '/api/rehearsal') {
    const c = newCall('rehearsal-' + randomUUID(),'local rehearsal',{ at: new Date().toISOString(), positions:[{ venue:'simulation', market:'BTC-DEMO-REPLAY', side:'yes', quantity:10, bid:0.42 }] },'simulation');
    say(c,propose(c,{market:'BTC-DEMO-REPLAY',side:'yes',pct:50})); persist(c); log('rehearsal_started',{call_id:c.call_id}); return send(res,200,c);
  }
  if (req.method === 'POST' && req.url === '/api/rehearsal/turn') {
    const input = JSON.parse((await body(req)).toString()); const c = getCall(input.call_id);
    if (!c || c.mode !== 'simulation' || typeof input.text !== 'string' || input.text.length > 1000) return send(res,400,{error:'Invalid rehearsal'});
    const gateReply = receiveTurn(c,input.text);
    let text = gateReply;
    if (!text && /^(25|50|100)$/.test(input.text.trim())) text = propose(c,{market:'BTC-DEMO-REPLAY',side:'yes',pct:Number(input.text.trim())});
    say(c,text || 'Nothing was executed. Enter 25, 50 or 100 for a fresh exact proposal, then confirm on a separate turn.'); persist(c); log('rehearsal_turn',{call_id:c.call_id,orders:c.orders.length}); return send(res,200,c);
  }
  return send(res,404,{error:'Not found'});
}
function handler(fn) { return (req,res) => fn(req,res).catch(() => { if (!res.headersSent) send(res,400,{error:'Request could not be processed'}); else res.end(); }); }
const ingressServer = http.createServer(handler((req,res) => hosted && req.url !== '/health' && !req.url.startsWith('/agentphone/') ? dashboard(req,res) : ingress(req,res)));
const uiServer = http.createServer(handler(dashboard));
for (const server of [ingressServer,uiServer]) { server.requestTimeout=25000; server.on('error', e => { console.error(`Server could not start: ${e.code}`); process.exit(1); }); }
const rules = readFileSync(path.join(root,'rules.md'),'utf8');
const prior = db.prepare('SELECT text FROM rules_history ORDER BY id DESC LIMIT 1').get();
if (prior?.text !== rules) db.prepare('INSERT INTO rules_history(at,text) VALUES (?,?)').run(new Date().toISOString(),rules);
ingressServer.listen(port,hosted?'0.0.0.0':'127.0.0.1',() => console.log(`Night Desk ingress ready on ${port}; hosted=${hosted}`));
if (!hosted) uiServer.listen(uiPort,'127.0.0.1',() => console.log(`Night Desk: http://127.0.0.1:${uiPort}`));
log('started',{mode:'read-only',model_configured:!!config.OPENROUTER_MODEL});
if (!config.CLOUD_URL) await refresh();
if (hosted) { setInterval(refresh,60000).unref(); overnight.start(); sportsDemo.start(); setInterval(()=>void actionReceipts().catch(e=>log('action_receipt_error',{error:e.message})),15000).unref(); }
// Only the hosted worker schedules overnight decisions; the local dashboard is a proxy.
process.on('SIGTERM',() => { overnight.stop(); sportsDemo.stop(); ingressServer.close(); uiServer.close(); db.close(); process.exit(0); });

