'use client';
import {useEffect,useState,useRef} from 'react';import {useSearchParams,useRouter} from 'next/navigation';
import ApiLoadError from '../../components/ApiLoadError';
import BackButton from '../../components/layout/BackButton';import SiteHeader from '../../components/SiteHeader';import SiteFooter from '../../components/layout/SiteFooter';import {useAuth} from '../../components/auth/AuthProvider';import {apiFetch,safeStudentNext} from '../../lib/api';import {money} from '../../lib/money';import {getPublicSiteContent} from '../../lib/publicSiteContent';
import {checkoutId,checkoutAddress,checkoutScope,checkoutLegacyKey,readCheckoutAttempt,saveCheckoutAttempt,forgetCheckoutAttempt,type CheckoutAttempt} from '../../lib/checkoutSafety';
export default function Checkout(){
 const query=useSearchParams(),router=useRouter(),{user,ready}=useAuth(),slug=query.get('course')||'',requestedPlan=query.get('plan')||'';
 const [mode,setMode]=useState<'course'|'membership'>(requestedPlan||!slug?'membership':'course'),[plans,setPlans]=useState<any[]>([]),[plan,setPlan]=useState(requestedPlan),[purchase,setPurchase]=useState<any>(null),[methods,setMethods]=useState<any>({}),[optionKey,setOptionKey]=useState(''),[loading,setLoading]=useState(true),[busy,setBusy]=useState(''),[error,setError]=useState('');
 const renewalOf=query.get('renewal')||'';
 const keys=useRef<Record<string,string>>({}),paymentLock=useRef(false),alive=useRef(true),leaving=useRef(false),lastAttempt=useRef<CheckoutAttempt|null>(null),operation=useRef(0),currentScope=useRef('');
 const [pendingAttempt,setPendingAttempt]=useState<CheckoutAttempt|null>(null);
 const [slow,setSlow]=useState(false),[recovering,setRecovering]=useState(false),[canStartNew,setCanStartNew]=useState(false);
 useEffect(()=>{alive.current=true;const restored=(event:PageTransitionEvent)=>{if(!event.persisted&&!leaving.current)return;operation.current++;paymentLock.current=false;leaving.current=false;setBusy('');setRecovering(false);};window.addEventListener('pageshow',restored);return()=>{alive.current=false;window.removeEventListener('pageshow',restored);};},[]);
 useEffect(()=>{setSlow(false);if(!busy)return;const timer=setTimeout(()=>setSlow(true),8000);return()=>clearTimeout(timer);},[busy]);
 const [bootstrapError,setBootstrapError]=useState(''),[bootstrapLoading,setBootstrapLoading]=useState(true),[bootstrapRevision,setBootstrapRevision]=useState(0),[priceRevision,setPriceRevision]=useState(0);
 useEffect(()=>{if(ready&&!user)router.replace('/login?next='+encodeURIComponent(safeStudentNext('/checkout?'+query.toString())));},[ready,user,router,query]);
 useEffect(()=>{let alive=true;setBootstrapLoading(true);setBootstrapError('');Promise.all([getPublicSiteContent(bootstrapRevision>0),apiFetch('/payments/methods')]).then(([content,payments])=>{if(!alive)return;const items=(Array.isArray(content.membershipPlans)?content.membershipPlans:[]).filter((p:any)=>p.active!==false);setPlans(items);setPlan(p=>items.some((x:any)=>x.name===p)?p:items[0]?.name||'');setMethods(payments.methods||{});}).catch(e=>{if(alive)setBootstrapError(e.message);}).finally(()=>{if(alive)setBootstrapLoading(false);});return()=>{alive=false;};},[bootstrapRevision]);
 const product=mode==='course'?slug:plan,owner=String(user?.id||user?._id||''),scope=checkoutScope(owner,mode,product,renewalOf);
 currentScope.current=scope;
 const isCurrent=(ticket:number)=>alive.current&&ticket===operation.current&&currentScope.current===scope;
 useEffect(()=>{
  operation.current++;paymentLock.current=false;leaving.current=false;setBusy('');setRecovering(false);
  let previous:CheckoutAttempt|null=null;
  if(owner&&product)try{previous=readCheckoutAttempt(sessionStorage,scope);}catch{}
  lastAttempt.current=previous;setPendingAttempt(previous);setCanStartNew(false);
  if(previous){setOptionKey(previous.optionKey);setError('An existing checkout was found. Choose either payment method; the previous checkout will be checked and safely closed before a new one opens.');}
 },[scope]);
 function remember(a:CheckoutAttempt){lastAttempt.current=a;setPendingAttempt(a);try{saveCheckoutAttempt(sessionStorage,a);}catch{}}
 function forget(a:CheckoutAttempt){delete keys.current[checkoutLegacyKey(a)];try{forgetCheckoutAttempt(sessionStorage,a);}catch{}lastAttempt.current=null;setPendingAttempt(null);}

 useEffect(()=>{if(!product){setPurchase(null);setLoading(false);return;}const controller=new AbortController();setLoading(true);setError(lastAttempt.current?'An existing checkout was found. Choose either payment method; the previous checkout will be checked and safely closed before a new one opens.':'');setPurchase(null);apiFetch('/payments/catalog?'+new URLSearchParams({kind:mode,product}),{signal:controller.signal}).then(d=>{if(controller.signal.aborted)return;if(!d.purchase||typeof d.purchase!=='object'||(d.purchase.offers!==undefined&&!Array.isArray(d.purchase.offers)))throw new Error('The price response was incomplete. Please retry loading prices.');setPurchase(d.purchase);setOptionKey(lastAttempt.current?.optionKey||d.purchase.offers?.[0]?.key||'');}).catch(e=>{if(!controller.signal.aborted)setError(e.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});return()=>controller.abort();},[mode,product,owner,priceRevision]);
 const offer=purchase?.offers?.find((o:any)=>o.key===optionKey),available=['stripe','paypal'].some(k=>methods[k]?.enabled);
 function checkoutKey(provider:string){const key=[owner,mode,product,optionKey,provider,renewalOf].join('|');if(keys.current[key])return keys.current[key];let id='';try{id=sessionStorage.getItem('sa-checkout:'+key)||'';}catch{}if(!id){id=checkoutId();try{sessionStorage.setItem('sa-checkout:'+key,id);}catch{}}keys.current[key]=id;return id;}
 function openOrder(data:any,provider:string,ticket:number){
  if(!isCurrent(ticket))return false;
  if(data.url&&!data.order)throw new Error('The checkout response is incomplete. Check the existing checkout before paying again.');
  const attempt=lastAttempt.current;
  if(data.order&&attempt){
   if(data.order.provider!==attempt.provider||data.order.kind!==attempt.kind||data.order.product!==attempt.product||!/^[a-f0-9]{24}$/i.test(data.order._id||''))throw new Error('Checkout identity does not match this purchase. Check My Billing before paying again.');
   remember({...attempt,orderId:data.order._id});
  }
  if(data.order?.status==='paid'){
   if(!/^[a-f0-9]{24}$/i.test(data.order._id||''))throw new Error('The paid order reference is missing. Open My Billing; do not pay again.');
   if(lastAttempt.current)forget(lastAttempt.current);leaving.current=true;router.push('/checkout/return?order='+data.order._id);return true;
  }
  if(data.url&&data.order?.status==='pending'){const url=checkoutAddress(data.url,provider);leaving.current=true;window.location.assign(url);return true;}
  return false;
 }
 async function recoverAttempt(provider:string,key:string,ticket:number){
  if(!isCurrent(ticket))return false;setRecovering(true);
  try{
   // Reads only: a timeout never starts a new charge or substitutes a new key.
   const data=await apiFetch('/payments/checkout-status',{headers:{'Idempotency-Key':key}});
   if(!isCurrent(ticket))return false;
   if(data.order&&lastAttempt.current&&data.order.provider!==lastAttempt.current.provider&&
      ['stripe','paypal'].includes(data.order.provider)&&data.order.kind===mode&&data.order.product===product&&
      /^[a-f0-9]{24}$/i.test(data.order._id||'')){
    remember({...lastAttempt.current,provider:data.order.provider,orderId:data.order._id});
    if(data.order.status==='paid')return openOrder(data,data.order.provider,ticket);
    setError('Another tab already selected a payment method for this checkout. Choose either method again to check and switch safely.');
    return false;
   }
   if(openOrder(data,provider,ticket))return true;
   const closed=['expired','failed','cancelled'].includes(data.order?.status);setCanStartNew(closed);
   setError(data.order?.recoveryRequired?'The previous payment needs Academy reconciliation. Contact support with checkout '+data.order._id+'; do not make another payment.':closed?'The provider confirmed this checkout is closed. You can start a new checkout.':data.creationPending?'Your existing checkout is still being prepared. Check it again below; do not start another payment.':'The existing checkout is not ready. Retry the same payment method to keep the same order, or check My Billing first.');
   return false;
  }catch{if(isCurrent(ticket))setError('Payment status could not be confirmed. Your existing checkout key has been retained. Check the same checkout or My Billing before paying again.');return false;}
  finally{if(isCurrent(ticket))setRecovering(false);}
 }
 async function pay(provider:string){
  if(paymentLock.current||busy||!offer||!ready||!owner||bootstrapLoading||bootstrapError||loading||!methods[provider]?.enabled)return;
  let retained=lastAttempt.current;
  if(!retained)try{retained=readCheckoutAttempt(sessionStorage,scope);}catch{}
  if(retained&&(retained.owner!==owner||retained.kind!==mode||retained.product!==product)){
   setError('This saved checkout belongs to a different purchase. Open My Billing to review it.');return;
  }
  const ticket=++operation.current;paymentLock.current=true;leaving.current=false;setBusy(provider);setError('');setCanStartNew(false);
  try{
   let nextKey='';
   if(retained&&(retained.provider!==provider||canStartNew||retained.optionKey!==optionKey||retained.releaseRequested)){
    retained={...retained,releaseRequested:true};remember(retained);
    setRecovering(true);
    const released=await apiFetch('/payments/checkout/release',{method:'POST',
     headers:{'Idempotency-Key':retained.key},body:JSON.stringify({})});
    if(!isCurrent(ticket))return;
    const old=released.order;
    if(!old||old.provider!==retained.provider||old.kind!==retained.kind||old.product!==retained.product||
      (retained.orderId&&old._id!==retained.orderId))throw new Error('The previous checkout identity could not be verified.');
    if(old.status==='paid'){if(openOrder(released,retained.provider,ticket))return;}
    if(released.released!==true||!['failed','expired','cancelled'].includes(old.status)||
       typeof released.replacementKey!=='string'||!/^[-_a-zA-Z0-9]{16,128}$/.test(released.replacementKey))
      throw new Error('The previous payment is still being checked. Do not pay again yet.');
    nextKey=released.replacementKey;forget(retained);retained=null;setRecovering(false);
   }
   const key=nextKey||retained?.key||checkoutKey(provider);
   remember({owner,kind:mode,product,optionKey,renewalOf,provider:provider as 'stripe'|'paypal',key});
   const data=await apiFetch('/payments/checkout',{method:'POST',headers:{'Idempotency-Key':key},body:JSON.stringify({kind:mode,product,optionKey,provider,...(mode==='membership'&&plan===requestedPlan&&renewalOf?{renewalOf}:{})})});
   if(!isCurrent(ticket))return;if(!openOrder(data,provider,ticket))throw new Error('Checkout is being prepared. Check the existing order.');
  }catch(e:any){
   if(!isCurrent(ticket))return;setError(e.message);
   if(lastAttempt.current&&(!e.status||[408,409,429,500,502,503,504].includes(e.status)))await recoverAttempt(lastAttempt.current.provider,lastAttempt.current.key,ticket);
  }finally{if(isCurrent(ticket)&&!leaving.current){paymentLock.current=false;setBusy('');}}
 }
 async function checkExisting(){
  if(paymentLock.current||!lastAttempt.current)return;
  const {provider,key}=lastAttempt.current,ticket=++operation.current;paymentLock.current=true;setBusy(provider);
  try{await recoverAttempt(provider,key,ticket);}finally{if(isCurrent(ticket)&&!leaving.current){paymentLock.current=false;setBusy('');}}
 }
 function resetCheckout(){
  if(!canStartNew||busy)return;
  // Keep the old identity. The next explicit provider click obtains the same
  // server-issued replacement key, including when another tab chooses a method.
  setError('Choose Stripe or PayPal below.');
 }


 if(!ready||!user)return <main><SiteHeader/><div className="authLoading">Checking your session…</div></main>;
 if(mode==='course'&&purchase?.free)return <main><SiteHeader/><section className="checkoutWrap"><BackButton fallback={'/courses/'+slug} label="Back to course"/><span className="kicker">FREE COURSE</span><h1>{purchase.title}</h1><p>No payment is needed for this course. Start it from the course page to save your enrollment and progress.</p><a className="button" href={'/courses/'+slug}>Start Course →</a></section><SiteFooter/></main>;
 return <main><SiteHeader/><section className="checkoutWrap"><BackButton fallback={slug?'/courses/'+slug:'/academy'} label="Back"/><span className="kicker">SECURE CHECKOUT</span><h1>Choose your learning access.</h1><p>Select a course or Academy membership, then complete your payment with Stripe or PayPal.</p>{bootstrapError&&<ApiLoadError message={bootstrapError} onRetry={()=>setBootstrapRevision(n=>n+1)}/>} {error&&<div className="authError" role="alert">{error}{!purchase&&<button type="button" className="pill" onClick={()=>setPriceRevision(n=>n+1)}>Retry loading prices</button>}</div>}<div className="checkoutLayout"><div><div className="planChoice">{slug&&<button disabled={!!busy||!!pendingAttempt} className={mode==='course'?'selected':''} onClick={()=>setMode('course')}><b>Individual course</b><span>Access to your selected course</span></button>}<button disabled={!!busy||!!pendingAttempt} className={mode==='membership'?'selected':''} onClick={()=>setMode('membership')}><b>Academy membership</b><span>Published courses for your membership term</span></button></div>{mode==='membership'&&<div className="academyPlanGrid">{plans.map(p=><button disabled={!!busy} key={p.name} className={plan===p.name?'selected':''} onClick={()=>setPlan(p.name)}><b>{p.name}</b><span>{p.durationMonths??(p.period==='year'?12:1)} month(s)</span><strong>{money(p.price,p.currency||'USD')}</strong></button>)}</div>}{loading?<p role="status">Loading prices…</p>:purchase?.free?<a className="button" href={'/learn/'+slug}>Start free course →</a>:purchase?.membershipOnly?<p>This course is included in Academy membership. Choose a membership above.</p>:<>{purchase?.offers?.length>0&&<div className="checkoutOptions">{purchase.offers.map((o:any)=><label key={o.key}><input type="radio" name="offer" checked={optionKey===o.key} disabled={!!busy||!!pendingAttempt} onChange={()=>setOptionKey(o.key)}/><span><b>{o.label}</b><small>{mode==='membership'?`${o.durationMonths} month(s) of Academy membership`:`${o.durationMonths} month(s) of individual course access`}</small><small>One-time payment · no automatic renewal</small></span><strong>{money(o.amountMinor/100,o.currency)}</strong></label>)}</div>}<h2 className="paymentHeading">Choose your payment method</h2><div className="paymentGrid">{['stripe','paypal'].map(provider=><button key={provider} className={'paymentMethod '+provider} aria-busy={busy===provider} disabled={!!busy||bootstrapLoading||!!bootstrapError||loading||!offer||!methods[provider]?.enabled} onClick={()=>pay(provider)}><span className="paymentIcon" aria-hidden="true">{provider==='stripe'?'S':'P'}</span><span><b>{busy===provider?(recovering?'Checking existing checkout…':'Opening secure checkout…'):provider==='stripe'?'Pay with Stripe':'Pay with PayPal'}</b><small>{bootstrapLoading?'Loading payment options…':bootstrapError?'Temporarily unavailable':methods[provider]?.enabled?(provider==='stripe'?'Card payment on Stripe':'Continue securely to PayPal'):'Not connected yet'}</small></span></button>)}</div>{!bootstrapLoading&&!bootstrapError&&!available&&<p className="secureNote">Online payments are not connected yet. No payment can be taken until the Academy configures a payment provider.</p>}{Object.values(methods).some((m:any)=>m?.enabled&&m.environment==='test')&&<p className="paymentTestNote">Sandbox testing: test payments do not charge real money and are excluded from real collections.</p>}<p className="secureNote">No enrollment request or admin approval is needed for checkout. Access is activated only after the provider confirms payment. Card and PayPal account details stay with the payment provider.</p>{busy&&<p className="secureNote" role="status">{slow?'The payment provider is taking longer. Please stay on this page; your existing order is being used.':'Connecting securely to the payment provider…'}</p>}{pendingAttempt&&!canStartNew&&<div className="checkoutReturnActions"><button type="button" className="pill" disabled={!!busy} onClick={()=>void checkExisting()}>{recovering?'Checking…':'Check existing checkout'}</button><a className="pill" href="/billing">My Billing</a></div>}{error&&offer&&canStartNew&&<button className="pill" aria-busy={!!busy} disabled={!!busy} onClick={resetCheckout}>Start a new checkout</button>}</>}</div><aside className="orderSummary"><span className="kicker">ORDER SUMMARY</span><h2>{purchase?.title||'Choose an option'}</h2><div><span>Access</span><b>{mode==='course'?'Single course':'Academy membership'}</b></div><div><span>Total</span><b>{offer?money(offer.amountMinor/100,offer.currency):'—'}</b></div>{offer&&<div><span>Term</span><b>{`${offer.durationMonths} month(s)`}</b></div>}<hr/><p>Pay once for the selected term. Individual course renewals extend that course's expiry; membership renewals extend Academy-wide access. Access ends automatically when the paid term expires. There is no automatic recurring charge.</p><p>Your payment receipt and access dates will appear in My Billing and My Courses after confirmation.</p></aside></div></section><SiteFooter/></main>;
}
