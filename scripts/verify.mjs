import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { newCall, receiveTurn, propose, say, affirmative } from '../src/gate.mjs';
import { verifySignature } from '../src/webhook.mjs';
function call(){return newCall('check','local',{positions:[{venue:'simulation',market:'BTC-TEST',side:'yes',quantity:10,bid:.42}]},'simulation')}
function proposal(c,pct=50){say(c,propose(c,{market:'BTC-TEST',side:'yes',pct}))}
for(const text of ['yes but wait','yes, only 25 percent','yesterday','no','not yes','yes no','maybe','1','yes? no']) assert.equal(affirmative(text),false,text);
let c=call();receiveTurn(c,'yes');assert.equal(c.orders.length,0);
proposal(c);receiveTurn(c,'yes, only 25 percent');assert.equal(c.orders.length,0);assert.equal(c.pending,null);
proposal(c,25);assert.match(receiveTurn(c,'yes'),/Simulation complete/);assert.equal(c.orders[0].quantity,2.5);receiveTurn(c,'yes');assert.equal(c.orders.length,1);
c=call();proposal(c);c.pending.expires_at=0;receiveTurn(c,'yes');assert.equal(c.orders.length,0);
c=call();proposal(c);say(c,'Here is an unrelated answer');receiveTurn(c,'yes');assert.equal(c.orders.length,0);
c=call();proposal(c);c.context.positions[0].bid=.2;receiveTurn(c,'yes');assert.equal(c.orders.length,0);
c=call();c.mode='read-only';assert.throws(()=>proposal(c),/read-only/);
const raw=Buffer.from('{"event":"agent.message"}'),secret='local-test-secret',ts=String(Math.floor(Date.now()/1000));
const headers={'x-webhook-timestamp':ts,'x-webhook-signature':'sha256='+createHmac('sha256',secret).update(ts+'.').update(raw).digest('hex')};
assert.equal(verifySignature(raw,headers,secret),true);assert.equal(verifySignature(Buffer.from('{}'),headers,secret),false);assert.equal(verifySignature(raw,{...headers,'x-webhook-timestamp':'1'},secret),false);
console.log('PASS: exact consent, revision, expiry, repeated yes, intervening turn, changed price, read-only boundary, valid/tampered/stale signatures. No network requests or orders.');
