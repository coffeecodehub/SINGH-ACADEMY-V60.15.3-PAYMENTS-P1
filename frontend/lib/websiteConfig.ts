/** Tolerate malformed historical CMS settings without crashing every page/image. */
export function websiteConfig(value:any){
 const text:Record<string,string>={};
 if(value?.text&&typeof value.text==='object'&&!Array.isArray(value.text))for(const [key,v] of Object.entries(value.text))if(typeof v==='string')text[key]=v;
 const images=Array.isArray(value?.images)?value.images.filter((i:any)=>i&&typeof i.key==='string'&&typeof i.src==='string'&&typeof i.url==='string'):[];
 return {text,images};
}
