import {writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const context=process.env.CONTEXT||'development';
const branch=process.env.BRANCH||context;
const suffix=branch.replace(/[^a-zA-Z0-9-]/g,'-').slice(0,30)+'-'+createHash('sha256').update(branch).digest('hex').slice(0,8);
const storeName=context==='production'?'route-trips-production':`route-trips-${suffix}`;
writeFileSync('server/deployment.mjs',`// Generated at build time; contains no credentials.\nexport const storeName=${JSON.stringify(storeName)};\n`);
console.log('Trip storage deployment context:',context);
