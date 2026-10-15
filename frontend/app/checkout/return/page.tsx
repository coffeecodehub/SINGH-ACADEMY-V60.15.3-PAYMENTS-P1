'use client';
import Link from 'next/link';
import {useCallback,useEffect,useRef,useState} from 'react';
import {useSearchParams,useRouter} from 'next/navigation';
import {useAuth} from '../../../components/auth/AuthProvider';
import SiteHeader from '../../../components/SiteHeader';
import SiteFooter from '../../../components/layout/SiteFooter';
import {apiFetch,isAbortError} from '../../../lib/api';
import {money} from '../../../lib/money';
import {clearSettledCheckout} from '../../../lib/checkoutSafety';
/** Single-flight reconciliation; the server re-reads provider evidence and binds the owner.
 * A return URL, browser cancellation, or network timeout is NEVER payment evidence. */
export default function PaymentReturn(){
 const q=useSearchParams(),router=useRouter(),{user,ready}=useAuth(),owner=user?.id||'',id=q.get('order')||'',cancelled=q.get('cancelled')==='1';
 const[order,setOrder]=useState<any>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[round,setRound]=useState(0);
 const flight=useRef<AbortController|null>(null),generation=useRef(0),lastCheck=useRef(0);
 const refresh=useCallback(async(confirm=true)=>{
  if(!owner||flight.current)return;
  if(!/^[a-f0-9]{24}$/.test(id)){setError('Invalid order reference. Open My Billing to review your purchases.');return;}
  const c=new AbortController(),ticket=generation.current;flight.current=c;lastCheck.current=Date.now();setBusy(true);setError('');
  try{
   const d=await apiFetch('/payments/orders/'+id+(confirm?'/confirm':''),{...(confirm?{method:'POST'}:{}),signal:c.signal});
   if(c.signal.aborted||ticket!==generation.current)return;
   if(!d.order||typeof d.order!=='object'||d.order._id!==id||!['pending','creating','paid','failed','expired','cancelled'].includes(d.order.status))throw new Error('The payment status response was incomplete. Check again; do not pay again.');
   setOrder(d.order);
   if(d.order.status==='paid')try{clearSettledCheckout(sessionStorage,owner,id);}catch{}
  }catch(e:any){if(!isAbortError(e)&&!c.signal.aborted&&ticket===generation.current)setError(e.message||'Payment status is unavailable. Check My Billing before trying another payment.');}
  finally{if(ticket===generation.current){flight.current=null;setBusy(false);}}
 },[owner,id]);
 useEffect(()=>{if(ready&&!user)router.replace('/login?next='+encodeURIComponent('/checkout/return?order='+id+(cancelled?'&cancelled=1':'')));},[ready,owner,router,id,cancelled]);
 useEffect(()=>{
  generation.current++;setOrder(null);setRound(0);setError('');if(owner)void refresh(!cancelled);
  return()=>{generation.current++;flight.current?.abort();flight.current=null;};
 },[owner,id,cancelled,refresh]);
 useEffect(()=>{
  if(!owner||!/^[a-f0-9]{24}$/.test(id)||order?.status==='paid'||['failed','expired','cancelled'].includes(order?.status)||cancelled)return;
  const visible=()=>{if(document.visibilityState==='visible'&&navigator.onLine&&Date.now()-lastCheck.current>3000)void refresh(true);};
  const timer=round<10&&!busy?setTimeout(()=>{if(document.visibilityState==='visible'&&navigator.onLine){setRound(n=>n+1);void refresh(true);}},6000):null;
  window.addEventListener('pageshow',visible);window.addEventListener('online',visible);document.addEventListener('visibilitychange',visible);
  return()=>{if(timer)clearTimeout(timer);window.removeEventListener('pageshow',visible);window.removeEventListener('online',visible);document.removeEventListener('visibilitychange',visible);};
 },[owner,id,order?.status,round,cancelled,busy,refresh]);
 if(!ready||!user)return <main><SiteHeader/><section className="accessChecking">Checking your session…</section></main>;
 const chooseMethod=(order?.kind==='membership'?'/checkout?plan='+encodeURIComponent(order.product||''):'/checkout?course='+encodeURIComponent(order?.product||''))+(order?.renewalOf?'&renewal='+encodeURIComponent(order.renewalOf):'');
 const paid=order?.status==='paid',closed=['failed','expired','cancelled'].includes(order?.status);
 return <main><SiteHeader/><section className="checkoutReturnCard"><span className="kicker">{paid?'PAYMENT CONFIRMED':'PAYMENT STATUS'}</span><h1>{paid?'You’re ready to learn.':closed?'Checkout was not completed.':cancelled?'Check your existing checkout.':error?'Check your payment status.':'Confirming your payment…'}</h1>{error&&<div className="authError" role="alert">{error}</div>}{order&&<><h2>{order.title}</h2><p>{money(order.amountMinor/100,order.currency)} · {order.provider==='stripe'?'Stripe':'PayPal'}</p>{order.environment==='test'&&<p className="paymentTestNote">Sandbox payment only. No real money was collected.</p>}{paid?<><p>Your payment has been verified. {order.accessStartsAt&&new Date(order.accessStartsAt)>new Date()?`Your access starts ${new Date(order.accessStartsAt).toLocaleString()}.`:'Your learning access is available in My Courses.'}</p>{order.grantNote&&<p className="paymentTestNote">{order.grantNote}</p>}<div className="checkoutReturnActions"><Link prefetch={false} className="button" href={order.kind==='course'&&!order.grantNote?'/learn/'+encodeURIComponent(order.product):'/my-course'}>Go to My Courses →</Link><Link prefetch={false} className="pill" href="/billing">View payment receipt</Link></div></>:<><p>{closed?'This checkout is closed. Review My Billing before starting another payment.':cancelled?'No new capture is requested from this cancelled return. You may check whether a payment was already completed.':'Please wait while the payment provider confirms your order. Do not pay again if money has already been deducted.'}</p><div className="checkoutReturnActions"><button className="button" aria-busy={busy} disabled={busy} onClick={()=>void refresh(!cancelled)}>{busy?'Checking…':'Check payment status'}</button><Link prefetch={false} className="pill" href="/billing">My Billing</Link><Link prefetch={false} className="pill" href={chooseMethod}>Choose payment method</Link><Link prefetch={false} className="pill" href="/courses">Back to courses</Link></div></>}</>}{!order&&<div className="checkoutReturnActions"><button className="button" aria-busy={busy} disabled={busy} onClick={()=>void refresh(!cancelled)}>{busy?'Checking payment…':'Retry status check'}</button><Link prefetch={false} className="pill" href="/billing">My Billing</Link></div>}</section><SiteFooter/></main>;
}
