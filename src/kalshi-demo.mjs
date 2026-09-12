import {createSign,constants} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {config} from './config.mjs';
export async function kalshiDemo(method,path,body){
  if(config.KALSHI_ENV!=='demo'||!path.startsWith('/')||path.startsWith('//')||path.includes('..'))throw new Error('Kalshi demo route required');
  const url=new URL('https://external-api.demo.kalshi.co/trade-api/v2'+path),timestamp=String(Date.now());
  const signer=createSign('RSA-SHA256').update(timestamp+method+url.pathname);
  const signature=signer.sign({key:config.KALSHI_PRIVATE_KEY||readFileSync(config.KALSHI_PRIVATE_KEY_PATH),padding:constants.RSA_PKCS1_PSS_PADDING,saltLength:constants.RSA_PSS_SALTLEN_DIGEST},'base64');
  const r=await fetch(url,{method,headers:{'KALSHI-ACCESS-KEY':config.KALSHI_API_KEY_ID,'KALSHI-ACCESS-TIMESTAMP':timestamp,'KALSHI-ACCESS-SIGNATURE':signature,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(10000)});
  const data=await r.json();if(!r.ok){const e=new Error('Kalshi demo HTTP '+r.status+': '+JSON.stringify(data));e.httpStatus=r.status;throw e;}return data;
}
