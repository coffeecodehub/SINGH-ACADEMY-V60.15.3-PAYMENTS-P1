/** Secure unique request keys also work on HTTP LAN testing where randomUUID is absent. */
export function checkoutId(source:Crypto=globalThis.crypto):string{
 if(typeof source?.randomUUID==='function')return source.randomUUID();
 if(typeof source?.getRandomValues!=='function')throw new Error('Secure checkout requires a browser with cryptographic randomness. Open the HTTPS website in an up-to-date browser.');
 return Array.from(source.getRandomValues(new Uint8Array(24)),b=>b.toString(16).padStart(2,'0')).join('');
}
export function checkoutAddress(value:unknown,provider:string):string{
 if(typeof value!=='string')throw new Error('The provider checkout address was not returned. Retry using the same checkout.');
 const u=new URL(value),hosts=provider==='stripe'?['checkout.stripe.com']:provider==='paypal'?['www.paypal.com','www.sandbox.paypal.com']:[];
 if(u.protocol!=='https:'||u.username||u.password||u.port||!hosts.includes(u.hostname))throw new Error('Invalid provider checkout address.');
 return u.href;
}

/** Client-side retry identity only, never payment evidence. Store no card data,
 * access grant, price or credentials here; the backend owns those decisions. */
export type CheckoutAttempt={owner:string;kind:'course'|'membership';product:string;optionKey:string;renewalOf:string;provider:'stripe'|'paypal';key:string;orderId?:string;releaseRequested?:boolean};
export function checkoutScope(owner:string,kind:string,product:string,renewalOf=''){
 return 'sa-checkout-active:'+JSON.stringify([owner,kind,product,renewalOf]);
}
export function checkoutLegacyKey(a:CheckoutAttempt){return [a.owner,a.kind,a.product,a.optionKey,a.provider,a.renewalOf].join('|');}
export function readCheckoutAttempt(storage:Pick<Storage,'getItem'>,scope:string):CheckoutAttempt|null{
 try{
  const raw=storage.getItem(scope);if(!raw||raw.length>2000)return null;
  const a=JSON.parse(raw);
  if(!a||typeof a.owner!=='string'||!a.owner||!['course','membership'].includes(a.kind)||typeof a.product!=='string'||!a.product||a.product.length>200||typeof a.optionKey!=='string'||a.optionKey.length>30||typeof a.renewalOf!=='string'||!['stripe','paypal'].includes(a.provider)||!/^[-_a-zA-Z0-9]{16,128}$/.test(a.key)||checkoutScope(a.owner,a.kind,a.product,a.renewalOf)!==scope)return null;
  if(a.releaseRequested!==undefined&&typeof a.releaseRequested!=='boolean')return null;
  if(a.orderId!==undefined&&!/^[a-f0-9]{24}$/i.test(a.orderId))return null;
  return {owner:a.owner,kind:a.kind,product:a.product,optionKey:a.optionKey,renewalOf:a.renewalOf,provider:a.provider,key:a.key,...(a.orderId?{orderId:a.orderId}:{}),...(a.releaseRequested?{releaseRequested:true}:{})};
 }catch{return null;}
}
export function saveCheckoutAttempt(storage:Pick<Storage,'setItem'>,a:CheckoutAttempt){
 try{storage.setItem(checkoutScope(a.owner,a.kind,a.product,a.renewalOf),JSON.stringify(a));return true;}catch{return false;}
}
export function forgetCheckoutAttempt(storage:Pick<Storage,'removeItem'>,a:CheckoutAttempt){
 try{storage.removeItem(checkoutScope(a.owner,a.kind,a.product,a.renewalOf));storage.removeItem('sa-checkout:'+checkoutLegacyKey(a));}catch{}
}
/** Call only AFTER the owned server order is confirmed paid/terminal. Never on
 * a browser cancel URL, timeout, unknown response, or another student's order. */
export function clearSettledCheckout(storage:Storage,owner:string,orderId:string){
 if(!owner||!/^[a-f0-9]{24}$/i.test(orderId))return;
 try{
  const keys:string[]=[];
  for(let i=0;i<storage.length;i++){const k=storage.key(i);if(k?.startsWith('sa-checkout-active:'))keys.push(k);}
  for(const key of keys){const a=readCheckoutAttempt(storage,key);if(a?.owner===owner&&a.orderId===orderId)forgetCheckoutAttempt(storage,a);}
 }catch{}
}
