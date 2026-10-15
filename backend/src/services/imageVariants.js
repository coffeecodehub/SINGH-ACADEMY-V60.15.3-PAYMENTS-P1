import {createContentCache} from './catalogCache.js';
import {createImageWorkQueue} from './imageWorkQueue.js';
export function imageWidth(raw){return /^(240|480|720|1080|1600)$/.test(String(raw||''))?Number(raw):0;}
async function resize(original,width){
 const {default:sharp}=await import('sharp');
 return sharp(original,{limitInputPixels:25000000,animated:false}).rotate().resize({width,withoutEnlargement:true}).webp({quality:78,effort:3}).toBuffer();
}
/** Factory allows queue/cache tests without substituting the application route
 * or importing a fake production image library. */
export function createPublicImageVariantService({transform=resize,clock=Date.now}={}){
 const variants=createContentCache({limit:80,maxBytes:24*1024*1024,clock});
 const sources=createContentCache({limit:12,maxBytes:16*1024*1024,clock});
 const jobs=createImageWorkQueue();
 return async function variant(bucket,id,file,width){
  // Defense in depth: this does NOT replace current publication authorization
  // in mediaRoutes. Only the route can prove that an image is public.
  if(!imageWidth(width)||!Number.isFinite(file.length)||file.length<=0||file.length>10*1024*1024||
    (file.metadata?.purpose&&file.metadata.purpose!=='cms')||!/^image\/(jpeg|png|webp|gif)$/.test(file.contentType||''))return null;
  const revision=String(id)+':'+file.length+':'+String(file.uploadDate||'');
  return variants.get(revision+':'+width,()=>jobs.run(async()=>{
   // Different responsive sizes share one source download. Never a private
   // receipt/assignment, video, arbitrary remote URL or unauthorised source.
   const original=await sources.get(revision,async()=>{
    const chunks=[];let length=0;
    for await(const chunk of bucket.openDownloadStream(id)){length+=chunk.length;if(length>10*1024*1024)throw new Error('Image size limit exceeded');chunks.push(chunk);}
    return Buffer.concat(chunks);
   },60000,{cacheNull:false});
   return transform(original,width);
  }),300000,{cacheNull:false});
 };
}
/** Called ONLY after mediaRoutes proves current published non-private CMS use.
 * Authorization runs on EVERY request before either byte cache. */
export const publicImageVariant=createPublicImageVariantService();
