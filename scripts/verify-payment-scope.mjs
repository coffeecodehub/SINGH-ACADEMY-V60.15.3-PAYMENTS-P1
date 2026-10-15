import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
export function verifyPaymentUiScope(){
 const list=JSON.parse(fs.readFileSync(path.join(root,'docs/payment-ui-baseline.json'),'utf8'));
 const failures=[];
 for(const entry of list.files){
  const file=path.join(root,entry.path);
  if(!fs.existsSync(file)){failures.push(entry.path+': missing');continue;}
  const hash=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  if(hash!==entry.sha256)failures.push(entry.path+': changed');
 }
 if(failures.length)throw new Error('UI baseline differs from the supplied project: '+failures.slice(0,5).join('; ')+'. Stop and review; no automatic repair is made.');
 console.log(`PASS ${list.files.length} original frontend files/assets are byte-identical to the supplied project.`);
 return {checked:list.files.length,changed:0};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))try{verifyPaymentUiScope();}catch(e){console.error(e.message);process.exitCode=1;}
