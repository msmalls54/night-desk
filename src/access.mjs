import { timingSafeEqual } from 'node:crypto';
import { config } from './config.mjs';
const equal = (a,b) => { const x=Buffer.from(a||''),y=Buffer.from(b||''); return x.length===y.length && timingSafeEqual(x,y); };
export function authenticated(req) {
  if (!config.DASHBOARD_TOKEN) return false;
  const auth=req.headers.authorization||'';
  if (auth.startsWith('Bearer ')) return equal(auth.slice(7),config.DASHBOARD_TOKEN);
  if (auth.startsWith('Basic ')) return equal(Buffer.from(auth.slice(6),'base64').toString(),`nightdesk:${config.DASHBOARD_TOKEN}`);
  return false;
}
export function challenge(res) { res.writeHead(401,{'WWW-Authenticate':'Basic realm="Night Desk private dashboard"','Cache-Control':'no-store'});res.end('Private Night Desk dashboard. Sign in to continue.'); }
