import { createHmac, timingSafeEqual, createHash } from 'node:crypto';
export function verifySignature(raw, headers, secret) {
  const timestamp = headers['x-webhook-timestamp'];
  const signature = headers['x-webhook-signature'];
  if (!secret || typeof timestamp !== 'string' || !/^\d+$/.test(timestamp) || Math.abs(Date.now()/1000-Number(timestamp)) > 300 || typeof signature !== 'string') return false;
  const expected = 'sha256=' + createHmac('sha256', secret).update(timestamp + '.').update(raw).digest('hex');
  const a = Buffer.from(signature), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a,b);
}
export const bodyHash = raw => createHash('sha256').update(raw).digest('hex');
