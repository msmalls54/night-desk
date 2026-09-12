import { randomUUID } from 'node:crypto';
export function affirmative(text) {
  return /^(yes|yes please|yes do it|yes i confirm|i confirm|confirm)$/i.test(String(text).trim().replace(/[.!?,]+$/g, '').trim());
}
export function newCall(id, to, context, mode = 'read-only') {
  return { call_id: id, to_number: to, context: structuredClone(context), mode, created_at: new Date().toISOString(), transcript: [], tool_calls: [], orders: [], pending: null, status: 'active' };
}
export function propose(call, { market, side, pct }) {
  if (call.mode !== 'simulation') throw new Error('Provider execution is not enabled. Portfolio is read-only.');
  const p = call.context.positions?.find(p => p.market === market && p.side === side && p.venue === 'simulation');
  if (!p || !['yes', 'no'].includes(side) || ![25, 50, 100].includes(pct)) throw new Error('Choose a valid simulated contract and 25, 50, or 100 percent.');
  const quantity = Math.floor(p.quantity * pct) / 100;
  if (!(quantity > 0) || !Number.isFinite(p.bid) || p.bid <= 0 || p.bid >= 1) throw new Error('No executable simulated quantity or price.');
  const a = { id: randomUUID(), venue: 'simulation', market, side, pct, quantity, min_price: p.bid, expires_at: Date.now() + 120000 };
  const text = `Simulation only: sell ${quantity} ${side.toUpperCase()} contracts of ${market} (${pct} percent) with a minimum price of $${p.bid.toFixed(2)} per contract. No provider order will be sent. Do you confirm this exact action?`;
  a.readback = text;
  call.pending = a;
  return text;
}
// Called BEFORE the model. Model arguments cannot assert caller consent.
export function receiveTurn(call, text) {
  const previous = call.transcript.at(-1);
  const pending = call.pending;
  call.pending = null;
  call.transcript.push({ role: 'user', content: text, at: new Date().toISOString() });
  if (!pending || !affirmative(text)) return null;
  if (call.status !== 'active' || call.mode !== 'simulation' || pending.expires_at < Date.now() || previous?.role !== 'assistant' || previous.content !== pending.readback) {
    return 'That proposal is no longer valid. Please request a fresh readback. Nothing was executed.';
  }
  const p = call.context.positions.find(p => p.market === pending.market && p.side === pending.side && p.venue === 'simulation');
  if (!p || p.quantity < pending.quantity || p.bid < pending.min_price) return 'The position or price changed. Nothing was executed. Please request a fresh proposal.';
  p.quantity = Number((p.quantity - pending.quantity).toFixed(4));
  const order = { id: `SIM-${randomUUID()}`, action_id: pending.id, market: pending.market, side: pending.side, quantity: pending.quantity, price: pending.min_price, status: 'simulated_fill', at: new Date().toISOString(), provider_order: false };
  call.orders.push(order);
  return `Simulation complete: sold ${order.quantity} ${order.side.toUpperCase()} contracts of ${order.market} at $${order.price.toFixed(2)}. No provider order was placed. A receipt draft is saved locally.`;
}
export function say(call, text, hangup = false) {
  call.transcript.push({ role: 'assistant', content: text, at: new Date().toISOString() });
  if (hangup) { call.status = 'ended'; call.pending = null; }
  return { text, ...(hangup ? { hangup: true } : {}) };
}
