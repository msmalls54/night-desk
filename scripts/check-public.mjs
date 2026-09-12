import {readdirSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const forbidden=/(^|\/)(PRIVATE|data|outputs|node_modules)(\/|$)|(^|\/)\.env(?:$|\.(?!example$))|\.(pem|key|sqlite(?:3)?|db|log)$/i;
const signatures=[/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,/sk-or-v1-[a-f0-9]{32,}/i,/gh[pousr]_[A-Za-z0-9]{30,}/,/github_pat_[A-Za-z0-9_]{30,}/];
const failures=[];let count=0;
function visit(dir){for(const entry of readdirSync(dir,{withFileTypes:true})){
  if(entry.name==='.git')continue;
  const absolute=path.join(dir,entry.name),relative=path.relative(root,absolute).replaceAll('\\','/');
  if(forbidden.test(relative)){failures.push(relative+' (private path)');continue;}
  if(entry.isSymbolicLink()){failures.push(relative+' (symlink)');continue;}
  if(entry.isDirectory()){visit(absolute);continue;}
  const content=readFileSync(absolute,'utf8');count++;
  if(signatures.some(re=>re.test(content)))failures.push(relative+' (credential pattern)');
  if(relative==='.env.example')for(const line of content.split(/\r?\n/)){
    const match=line.match(/^([A-Z_]*(?:KEY|TOKEN|SECRET|PHONE|EMAIL|INBOX))=(.*)$/);
    if(match&&match[2].trim())failures.push(relative+' (nonblank private setting)');
  }
}}
visit(root);
if(failures.length){console.error('Public export check failed:\n'+failures.join('\n'));process.exit(1);}
console.log(`PASS: ${count} public files checked; no forbidden paths or recognized credential patterns. This check is a guard, not a complete security audit.`);
