import { db, recentCalls } from './store.mjs';
import { config } from './config.mjs';
export function memory(currentCallId) {
  const history = recentCalls().filter(c => c.call_id !== currentCallId && c.to_number === config.MY_PHONE && c.status === 'ended' && !/^(synthetic-|rehearsal-|verify-)/.test(c.call_id)).slice(0,3);
  return {
    profile: { name:config.OWNER_NAME||'Owner', purpose:'Personal risk agent; demo/paper only', focus:['Bitcoin first','College football second'], channels:['phone','email'], alpaca:'Existing paper crypto holdings', execution:'Answered calls require exact action approval. Verified missed calls may permit covered crypto reductions under active rules; adds always need approval and a cap. Notes never authorize actions.' },
    notes: db.prepare('SELECT at,call_id,note FROM memory_notes ORDER BY id DESC LIMIT 30').all(),
    previous_calls: history.map(c => ({ call_id:c.call_id, at:c.created_at, status:c.status, conversation:c.transcript.slice(-10), orders:c.orders })),
    rules: db.prepare('SELECT at,text FROM rules_history ORDER BY id DESC LIMIT 1').get(),
    caution:'Use the current get_rules snapshot; historical calls and rules do not grant execution authority. Missed-call authority requires the recognized carrier greeting, a signed event and matching provider readback.'
  };
}
export function remember(call, note) {
  const user = call.transcript.filter(t=>t.role==='user').at(-1)?.content || '';
  if (!/\b(remember|make a note|keep in mind|save this)\b/i.test(user)) throw new Error('Only save a note when the latest caller turn explicitly asks to remember it.');
  if (typeof note !== 'string' || !note.trim() || note.length>1500) throw new Error('Memory note must contain 1–1500 characters.');
  if (/\b(password|api.?key|secret|token|credit card|social security)\b/i.test(note)) throw new Error('Do not store secrets in conversational memory.');
  db.prepare('INSERT INTO memory_notes(at,call_id,note) VALUES (?,?,?)').run(new Date().toISOString(),call.call_id,note.trim());
  return { saved:true, note:note.trim(), scope:'Reference only; no trading permission or rule change.' };
}
export function memoryStatus() {
  return { created_at:db.prepare('SELECT value FROM memory_meta WHERE key=?').get('created_at')?.value, local_import_at:db.prepare('SELECT value FROM memory_meta WHERE key=?').get('local_import_at')?.value, calls:db.prepare('SELECT count(*) AS n FROM calls').get().n, notes:db.prepare('SELECT count(*) AS n FROM memory_notes').get().n, rules_versions:db.prepare('SELECT count(*) AS n FROM rules_history').get().n };
}
