import {spawnSync} from 'node:child_process';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
const tests=['verify','verify-context-map','verify-market-trims','verify-risk-calls','verify-voicemail-classification','verify-sports-demo-worker','verify-phone-portfolio-speech','verify-web-search','verify-owned-market-metadata','verify-btc-fifteen-minute-context','verify-crypto-demo-scope'];
const env={...process.env,DATA_DIR:mkdtempSync(path.join(tmpdir(),'night-desk-tests-')),DEMO_RUN_ENABLED:'false',NODE_NO_WARNINGS:'1'};
for(const test of tests){
  const run=spawnSync(process.execPath,['--import','./scripts/no-network.mjs','--experimental-vm-modules',`scripts/${test}.mjs`],{stdio:'inherit',env});
  if(run.status!==0)process.exit(run.status||1);
}
console.log(`All ${tests.length} offline suites passed.`);
