import net from 'node:net';
import fs from 'node:fs';
import {uploadScanConfiguration} from '../utils/uploadScanConfig.js';
import {scanCloudmersiveFile} from './uploadScanCloudmersive.js';
/** Provider dispatch. Explicit HTTPS scanning never falls back to an unscanned upload.
 * Legacy private-network ClamAV INSTREAM remains supported without changing its protocol. */
export async function scanFile(filePath,{signal,mime}={}){
 if(signal?.aborted)throw Object.assign(new Error('Upload cancelled.'),{name:'AbortError',status:499});
 const config=uploadScanConfiguration(process.env);
 if(config.errors.length)throw Object.assign(new Error('Upload scanner configuration is invalid. Ask the administrator to review the scanner settings.'),{status:503,code:'UPLOAD_SCAN_CONFIGURATION'});
 if(config.provider==='cloudmersive')return scanCloudmersiveFile(filePath,{signal,mime});
 const host=process.env.CLAMAV_HOST,required=config.required;
 if(!host){if(required)throw Object.assign(new Error('Upload scanner unavailable. Try again later.'),{status:503});return {status:'not-scanned-development'};}
 const port=Number(process.env.CLAMAV_PORT||3310),timeout=Number(process.env.UPLOAD_SCAN_TIMEOUT_MS||120000);
 return new Promise((resolve,reject)=>{
  const socket=net.createConnection({host,port});let source,settled=false,reply='';
  const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',onAbort);source?.destroy();socket.destroy();error?reject(error):resolve(result);};
  const unavailable=()=>Object.assign(new Error('Upload security scan could not be completed. Try again later.'),{status:503});
  const onAbort=()=>finish(Object.assign(new Error('Upload cancelled.'),{name:'AbortError',status:499}));
  const timer=setTimeout(()=>finish(unavailable()),Math.min(Math.max(timeout,5000),300000));
  signal?.addEventListener('abort',onAbort,{once:true});
  if(signal?.aborted){onAbort();return;}
  socket.on('error',()=>finish(unavailable()));
  socket.on('end',()=>{if(!settled)finish(unavailable());});
  socket.on('data',data=>{
   reply+=data.toString('utf8');if(reply.length>4096)return finish(unavailable());
   if(!reply.includes('\0')&&!reply.includes('\n'))return;
   if(/:\s*OK\s*\0?$/.test(reply.trim()))return finish(null,{status:'clean',engine:'clamav',scannedAt:new Date()});
   if(/ FOUND/.test(reply))return finish(Object.assign(new Error('Upload rejected by the malware scanner.'),{status:400}));
   finish(unavailable());
  });
  socket.on('connect',()=>{
   socket.write('zINSTREAM\0');source=fs.createReadStream(filePath,{highWaterMark:65536});
   source.on('error',()=>finish(unavailable()));
   source.on('data',chunk=>{const size=Buffer.alloc(4);size.writeUInt32BE(chunk.length);socket.write(size);if(!socket.write(chunk))source.pause();});
   socket.on('drain',()=>source?.resume());source.on('end',()=>socket.write(Buffer.alloc(4)));
  });
 });
}
