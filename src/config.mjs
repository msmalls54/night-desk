import { readFileSync, mkdirSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
export const root = fileURLToPath(new URL('../', import.meta.url));
let env = {};
try { env = parseEnv(readFileSync(path.join(root, '.env'), 'utf8')); } catch {}
export const config = { ...env, ...process.env };
// The active environment wins. Import only the required account credentials.
try {
  const saved = JSON.parse(readFileSync(path.join(root, 'PRIVATE/provider-store/credentials.json'), 'utf8'));
  for (const key of ['ALPACA_API_KEY', 'ALPACA_SECRET_KEY', 'GOOGLE_SERVICE_ACCOUNT_JSON']) config[key] ||= saved[key];
} catch {}
export const dataDir = config.DATA_DIR || path.join(root, 'PRIVATE/app-data');
mkdirSync(dataDir, { recursive: true });
