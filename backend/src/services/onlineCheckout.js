import {effectiveCourseEnrollment,baseGrantSnapshot} from './courseEntitlements.js';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import CheckoutOrder from '../models/CheckoutOrder.js';
import Course from '../models/Course.js';
import SiteContent from '../models/SiteContent.js';
import User from '../models/User.js';
import Invoice from '../models/Invoice.js';
import Payment from '../models/Payment.js';
import Subscription from '../models/Subscription.js';
import Enrollment from '../models/Enrollment.js';
import Notification from '../models/Notification.js';
import {audit} from './audit.js';
import {queueSubscriptionConfirmation,queueCourseConfirmation} from './studentNotifications.js';
import {syncMembershipCourseEnrollments} from './membershipEnrollments.js';
import {transaction} from './businessWrite.js';
import {objectId,capabilities} from './businessRead.js';
import {businessError,text,requestKey,stableJson,addMonths} from '../utils/business.js';
import {courseOffers,selectCourseOffer,planOffer,gatewayCurrency,requireGateway,assertEvidence,courseMonthPeriod,coursePeriod,realAccessFilter,activeEnrollmentWindow} from '../utils/commerce.js';
import {createStripeOrder,createPayPalOrder,stripeOrderBody,paypalOrderBody,providerCredentialFingerprint,findStripeOrder,stripeEvidence,paypalEvidence,closeStripeCheckout,closePayPalCheckout} from './paymentProviders.js';
const one=async(Model,body,session)=>(await Model.create([body],{session}))[0];
const digest=s=>crypto.createHash('sha256').update(s).digest('hex');
export function publicOrder(order){return {_id:order._id,provider:order.provider,environment:order.environment,kind:order.kind,product:order.product,...(order.renewalOf?{renewalOf:String(order.renewalOf)}:{}),title:order.title,optionLabel:order.optionLabel,currency:order.currency,amountMinor:order.amountMinor,status:order.status,cancellationRequested:Boolean(order.cancelRequestedAt),...(order.recoveryRequired?{recoveryRequired:true,recoveryMessage:'The previous payment needs Academy reconciliation. Do not make another payment until its status is confirmed.'}:{}),paidAt:order.paidAt,accessDays:order.accessDays,durationMonths:order.durationMonths,accessStartsAt:order.accessStartsAt,accessExpiresAt:order.accessExpiresAt,grantNote:order.grantNote};}
export async function catalog(kind,product){
 if(kind==='course'){
  const course=await Course.findOne({slug:product,published:true}).lean();if(!course)throw businessError('Published course not found.',404);
  return {kind,title:course.title,product:course.slug,free:course.accessType==='free',membershipOnly:course.accessType==='membership',offers:courseOffers(course)};
 }
 if(kind==='membership'){
  const settings=await SiteContent.findOne({key:'membershipPlans'}).lean(),plan=(settings?.value||[]).find(p=>p.name===product&&p.active!==false);
  if(!plan)throw businessError('Membership plan not found.',404);return {kind,title:plan.name,product:plan.name,offers:[planOffer(plan)]};
 }
 throw businessError('Choose a course or a membership.');
}
const CLOSED=new Set(['expired','failed','cancelled']);
function recoveryError(){const e=businessError('The previous payment needs Academy reconciliation. Its status is uncertain; do not pay again. Contact support with the checkout reference.',409);e.code='CHECKOUT_RECONCILIATION_REQUIRED';return e;}
async function markRecovery(order,reason){await CheckoutOrder.updateOne({_id:order._id,status:{$ne:'paid'}},{$set:{recoveryRequired:true,recoveryReason:reason}});}
async function persistRemote(order,claim,remote){
 if(typeof remote.id!=='string'||!remote.id||remote.id.length>150)throw businessError('Payment provider did not return a valid order ID.',502);
 const updated=await CheckoutOrder.findOneAndUpdate({_id:order._id,creationClaim:claim,providerOrderId:{$exists:false},status:{$in:['creating','pending']}},
  {$set:{providerOrderId:remote.id,approvalUrl:remote.url||null,status:CLOSED.has(remote.state)?remote.state:'pending',recoveryRequired:false},$unset:{creationClaim:1,creationClaimUntil:1,recoveryReason:1}},{new:true}).select('+approvalUrl');
 if(!updated)throw businessError('Checkout changed while being reconciled. Check the same order.',409);
 return {order:publicOrder(updated),url:updated.status==='pending'?updated.approvalUrl:null};
}
async function makeRemote(order,user,{allowReplay=true}={}){
 if(order.providerOrderId)return {order:publicOrder(order),url:order.approvalUrl};
 if(order.status==='paid'||CLOSED.has(order.status))return {order:publicOrder(order),url:null};
 const claim=crypto.randomUUID(),now=new Date();
 let claimed=await CheckoutOrder.findOneAndUpdate({_id:order._id,providerOrderId:{$exists:false},cancelRequestedAt:{$exists:false},status:{$in:['creating','pending']},$or:[{creationClaimUntil:{$exists:false}},{creationClaimUntil:{$lt:now}}]},
  {$set:{creationClaim:claim,creationClaimUntil:new Date(+now+90000)}},{new:true}).select('+creationPayload +creationCredentialFingerprint +approvalUrl');
 if(!claimed){const current=await CheckoutOrder.findById(order._id).select('+approvalUrl');if(current?.providerOrderId)return {order:publicOrder(current),url:current.approvalUrl};throw businessError('Checkout is being reconciled. Wait a moment and retry the same action.',409);}
 try{
  const neverSent=claimed.creationProtocolVersion===1&&!claimed.creationAttemptedAt;
  const activeGateway=requireGateway(claimed.provider);
  if(activeGateway.environment!==claimed.environment){await markRecovery(claimed,'Provider environment changed since original checkout.');throw recoveryError();}
  const fingerprint=providerCredentialFingerprint(claimed.provider);
  const sameCredential=claimed.creationCredentialFingerprint===fingerprint;
  if(!neverSent&&claimed.creationCredentialFingerprint&&!sameCredential){await markRecovery(claimed,'Provider credentials changed since original checkout. Verify original account before recovery.');throw recoveryError();}
  if(neverSent){
   if(!allowReplay)return {order:publicOrder(claimed),url:null};
   // The original request is durably captured BEFORE the external mutation.
   // Domain/email/price changes cannot alter a later idempotency replay.
   if(+new Date(claimed.expiresAt)<Date.now()+1800000)claimed.expiresAt=new Date(Date.now()+3600000);
   const payload=claimed.provider==='stripe'?stripeOrderBody(claimed,user):paypalOrderBody(claimed);
   const marked=await CheckoutOrder.findOneAndUpdate({_id:claimed._id,creationClaim:claim,creationAttemptedAt:{$exists:false}},
    {$set:{creationAttemptedAt:now,lastCreationAttemptedAt:now,creationCredentialFingerprint:fingerprint,creationPayload:payload,expiresAt:claimed.expiresAt}},{new:true}).select('+creationPayload +creationCredentialFingerprint');
   if(!marked)throw businessError('Checkout changed before provider creation.',409);claimed=marked;
  }else{
   const age=Date.now()-+new Date(claimed.creationAttemptedAt||0);
   // PayPal retention is API/account-specific. Unknown retention means no
   // missing-ID create replay; an operator can bind a verified existing order.
   const configuredPayPalSeconds=Number(process.env.PAYPAL_CREATE_REPLAY_SECONDS||0);
   const paypalSeconds=Number.isSafeInteger(configuredPayPalSeconds)&&configuredPayPalSeconds>=0&&configuredPayPalSeconds<=18000?configuredPayPalSeconds:0;
   const horizon=claimed.provider==='stripe'?23*3600000:paypalSeconds*1000;
   const replaySafe=sameCredential&&claimed.creationPayload&&age>=0&&age<horizon;
   if(!allowReplay||!replaySafe){
    if(claimed.provider==='stripe'){
     const search=await findStripeOrder(claimed);
     if(search.remote)return await persistRemote(claimed,claim,search.remote);
     // Only an exhaustive search AFTER this exact checkout's expiry and every
     // bounded in-flight creation can prove an absent Stripe session safe.
     if(sameCredential&&search.complete&&Date.now()>+new Date(claimed.expiresAt)+300000&&Date.now()>+new Date(claimed.lastCreationAttemptedAt||claimed.createdAt)+300000){
      const closed=await CheckoutOrder.findOneAndUpdate({_id:claimed._id,creationClaim:claim,providerOrderId:{$exists:false}},{$set:{status:'expired',recoveryRequired:false}},{new:true});
      return {order:publicOrder(closed),url:null};
     }
    }
    await markRecovery(claimed,'Creation replay cannot be proven idempotent within provider retention.');throw recoveryError();
   }
   await CheckoutOrder.updateOne({_id:claimed._id,creationClaim:claim},{$set:{lastCreationAttemptedAt:new Date()}});
  }
  const remote=claimed.provider==='stripe'?await createStripeOrder(claimed,user):await createPayPalOrder(claimed,user);
  const saved=await persistRemote(claimed,claim,remote);
  if(!saved.url&&!CLOSED.has(saved.order.status))saved.order=await syncCheckout(claimed._id,{userId:user._id,capture:false});
  return saved;
 }finally{await CheckoutOrder.updateOne({_id:order._id,creationClaim:claim},{$unset:{creationClaim:1,creationClaimUntil:1}});}
}
/** Operator/worker recovery is read-only by default. Replay is explicit and uses
 * the immutable original body/key, only within the provider retention horizon. */
export async function reconcileCreation(orderId,{allowReplay=false}={}){
 const order=await CheckoutOrder.findById(objectId(String(orderId))).select('+approvalUrl');
 if(!order)throw businessError('Checkout not found.',404);
 if(order.providerOrderId||order.status==='paid'||CLOSED.has(order.status))return syncCheckout(order._id,{capture:false});
 const user=await User.findOne({_id:order.user,role:'student'}).select('email');if(!user)throw businessError('Checkout customer needs review.',409);
 const result=await makeRemote(order,user,{allowReplay});return result.order;
}
/** Manual reconciliation binds a provider ID only after checking provider truth;
 * it never fabricates settlement and never calls PayPal capture. */
export async function bindRecoveredCheckout(orderId,providerOrderId){
 if(typeof providerOrderId!=='string'||!/^[-_A-Za-z0-9]{1,150}$/.test(providerOrderId))throw businessError('Invalid provider order reference.',400);
 const order=await CheckoutOrder.findById(objectId(String(orderId)));
 if(!order)throw businessError('Checkout not found.',404);
 if(order.providerOrderId&&order.providerOrderId!==providerOrderId)throw businessError('Checkout already has a different provider reference.',409);
 const candidate={...(order.toObject?order.toObject():order),providerOrderId};
 const evidence=order.provider==='stripe'?await stripeEvidence(candidate):await paypalEvidence(candidate,{capture:false});
 if(evidence.state==='paid')assertEvidence(candidate,evidence);
 const updated=await CheckoutOrder.findOneAndUpdate({_id:order._id,$or:[{providerOrderId:{$exists:false}},{providerOrderId}]},{$set:{providerOrderId,recoveryRequired:false}},{new:true});
 if(!updated)throw businessError('Checkout changed during reconciliation.',409);
 await audit(null,{scope:'business',action:'checkout.provider_reference_reconciled',targetUser:order.user,entityType:'checkout',entityId:String(order._id),changes:{provider:order.provider,providerOrderId}});
 return syncCheckout(order._id,{capture:false});
}
export async function startCheckout(req){
 const body=req.body||{},kind=text(body.kind,'Purchase type',20,1),product=text(body.product,'Course or plan',200,1),provider=text(body.provider,'Payment method',20,1),optionKey=body.optionKey==null?'':text(body.optionKey,'Price option',30);
 const renewalOf=body.renewalOf?String(objectId(body.renewalOf)):'';
 if(renewalOf&&(kind!=='membership'||!await Subscription.exists({_id:renewalOf,user:req.user._id,plan:product})))throw businessError('Membership renewal record not found.',404);
 const config=requireGateway(provider);if(!(await capabilities()).transactions)throw businessError('Checkout requires transaction-capable database storage. No payment was started.',503);
 const key=digest(String(req.user._id)+':'+requestKey(req)),fp=digest(stableJson({kind,product,provider,optionKey,renewalOf,environment:config.environment}));
 let order=await CheckoutOrder.findOne({requestKey:key,user:req.user._id}).select('+approvalUrl +requestFingerprint');
 if(order){if(order.cancelRequestedAt&&order.status!=='paid')throw businessError('The previous checkout is being closed. Choose a payment method again to check its status.',409);if(order.requestFingerprint!==fp)throw businessError('This checkout key belongs to another purchase.',409);if(order.status==='paid')return {order:publicOrder(order)};if(['expired','failed','cancelled'].includes(order.status))throw businessError('Start a new checkout from the course page.',409);return makeRemote(order,req.user);}
 let title,offer;
 if(kind==='course'){
  const course=await Course.findOne({slug:product,published:true}).lean();if(!course)throw businessError('Published course not found.',404);
  if(course.accessType==='free')throw businessError('This course is free. Open the lesson player to begin.',409);
  if(course.accessType==='membership')throw businessError('This course is available through an Academy membership. Choose membership access.',409);
  const now=new Date(),access=realAccessFilter();
  const membership=await Subscription.exists({user:req.user._id,status:'active',...access,startsAt:{$lte:now},endsAt:{$gt:now}});
  if(membership)throw businessError('Your active Academy membership already includes this course. Open My Courses instead of paying again.',409);
  title=course.title;offer=selectCourseOffer(course,optionKey);
 }else if(kind==='membership'){
  const data=await catalog(kind,product);title=data.title;offer=data.offers[0];
 }else throw businessError('Choose a course or membership.');
 if(offer.amountMinor<=0||offer.amountMinor>99999999)throw businessError('The price needs an Academy administrator review before checkout.',409);
 const currency=gatewayCurrency(offer.currency);
 try{order=await CheckoutOrder.create({user:req.user._id,provider,environment:config.environment,kind,product,title,renewalOf:renewalOf||undefined,optionKey:offer.key,optionLabel:offer.label,amountMinor:offer.amountMinor,currency,accessDays:0,durationMonths:offer.durationMonths,requestKey:key,requestFingerprint:fp,status:'creating',creationProtocolVersion:1,expiresAt:new Date(Date.now()+3600000)});}
 catch(error){if(error.code!==11000)throw error;order=await CheckoutOrder.findOne({requestKey:key,user:req.user._id}).select('+approvalUrl +requestFingerprint');if(!order||order.requestFingerprint!==fp)throw businessError('A conflicting checkout already exists.',409);}
 return makeRemote(order,req.user);
}
/** Recover an uncertain create response with the original key; do not create
 * another provider order just because a browser/network response was lost. */
export async function checkoutStatus(req){
 const key=digest(String(req.user._id)+':'+requestKey(req));
 const order=await CheckoutOrder.findOne({requestKey:key,user:req.user._id}).select('+approvalUrl');
 if(!order)return {found:false,order:null,url:null,creationPending:false};
 return {found:true,order:publicOrder(order),url:order.status==='pending'&&!order.cancelRequestedAt?order.approvalUrl||null:null,
  creationPending:!order.providerOrderId&&new Date(order.creationClaimUntil||0)>new Date()};
}
export async function fulfillOnlineOrder(orderId,evidence,verificationSource='provider_api'){
 // No external provider calls inside the transaction: retries must only repeat database operations.
 return transaction(async session=>{
  const order=await CheckoutOrder.findById(objectId(String(orderId))).session(session);if(!order)throw businessError('Checkout order not found.',404);assertEvidence(order,evidence);
  if(order.status==='paid')return publicOrder(order);
  const user=await User.findOneAndUpdate({_id:order.user,role:'student'},{$inc:{commerceVersion:1}},{new:true,session});
  if(!user)throw businessError('Paid order customer needs review.',409);
  const date=new Date(evidence.paidAt),testMode=order.environment==='test';let start=date,expires=null,grantNote='',grantStart=date,grantSuppressed=false,stored=null,preserveDisplay=false;
  // Serialize paid renewals per user, so independent successful payments cannot overwrite each other.
  if(order.kind==='membership'){
   const previous=await Subscription.findOne({user:user._id,status:'active',testMode:testMode?true:{$ne:true},endsAt:{$gt:date}}).sort({endsAt:-1}).session(session);
   if(previous)start=new Date(previous.endsAt);expires=addMonths(start,order.durationMonths);
  }else{
   stored=await Enrollment.findOne({user:user._id,courseSlug:order.product}).select('+baseGrant').session(session);
   const current=await effectiveCourseEnrollment(user._id,order.product,session,{environment:order.environment,now:date,includeScheduled:true});
   preserveDisplay=testMode&&stored&&stored.testMode!==true;
   if(current?.status==='active'&&new Date(current.accessStartsAt)>date){
    start=new Date(current.accessStartsAt);expires=current.accessExpiresAt;grantSuppressed=true;
    grantNote='Payment received; existing scheduled course access needs Academy review.';
   }else if(order.durationMonths==null&&current?.status==='active'&&new Date(current.accessStartsAt)<=date&&(!current.accessExpiresAt||new Date(current.accessExpiresAt)>date)){
    start=current.accessStartsAt;expires=current.accessExpiresAt;grantSuppressed=true;
    grantNote='Payment received while this course was already accessible. Existing access was preserved; contact the Academy to review the duplicate purchase.';
   }else{
    const period=order.durationMonths==null?coursePeriod(current,date,order.accessDays||0):courseMonthPeriod(current,date,order.durationMonths);
    start=period.startsAt;expires=period.endsAt;grantSuppressed=Boolean(period.alreadyLifetime);
    grantStart=current?.accessExpiresAt&&new Date(current.accessStartsAt)<=date&&new Date(current.accessExpiresAt)>date?new Date(current.accessExpiresAt):date;
    if(period.alreadyLifetime)grantNote='Payment received; existing legacy no-expiry course access was preserved.';
   }
   if(preserveDisplay&&!grantSuppressed)grantNote='Sandbox payment recorded separately; existing real course access was preserved.';
  }
  const invoice=await one(Invoice,{number:'SA-ONLINE-'+String(order._id).toUpperCase(),user:user._id,kind:order.kind,title:order.title,courseSlug:order.kind==='course'?order.product:undefined,planName:order.kind==='membership'?order.product:undefined,accessDays:order.accessDays,durationMonths:order.durationMonths,accessStartsAt:start,accessExpiresAt:expires,noScheduledExpiry:expires===null,grantVersion:1,grantStartsAt:order.kind==='course'?grantStart:start,grantExpiresAt:expires,grantNoExpiry:expires===null,grantSuppressed,renewalOf:order.renewalOf,dueAt:date,currency:order.currency,totalMinor:order.amountMinor,paidMinor:order.amountMinor,creditedMinor:0,status:'paid',paidAt:date,fulfillmentAt:new Date(),createdBy:user._id,origin:'online_checkout',testMode,requestKey:'online-invoice-'+String(order._id),requestFingerprint:digest(String(order._id))},session);
  const payment=await one(Payment,{user:user._id,invoice:invoice._id,checkoutOrder:order._id,kind:order.kind,courseSlug:order.kind==='course'?order.product:undefined,provider:order.provider,providerPaymentId:evidence.paymentId,providerRecordKey:[order.provider,order.environment,evidence.paymentId].join(':'),status:'paid',amountMinor:order.amountMinor,amount:order.amountMinor/100,currency:order.currency,paidAt:date,verifiedAt:new Date(),verificationSource,testMode,reference:evidence.paymentId,requestKey:'online-payment-'+String(order._id),requestFingerprint:digest(String(order._id))},session);
  if(order.kind==='membership'){const term=await one(Subscription,{user:user._id,plan:order.product,status:'active',startsAt:start,endsAt:expires,dueAt:null,durationMonths:order.durationMonths,priceMinor:order.amountMinor,currency:order.currency,invoice:invoice._id,source:'provider',cancelAtPeriodEnd:true,testMode},session);await syncMembershipCourseEnrollments({userId:user._id,startsAt:start,endsAt:expires,invoice:invoice._id,testMode,session,reason:`Academy membership: ${order.product}`});await queueSubscriptionConfirmation(term,session);}
  else if(!grantSuppressed&&!preserveDisplay)await Enrollment.findOneAndUpdate({user:user._id,courseSlug:order.product},{$set:{status:'active',accessStartsAt:start,accessExpiresAt:expires,source:'provider',invoice:invoice._id,reason:'Verified online payment '+evidence.paymentId,testMode,...(baseGrantSnapshot(stored)?{baseGrant:baseGrantSnapshot(stored)}:{})}},{upsert:true,new:true,runValidators:true,session});
  if(order.kind==='course')await queueCourseConfirmation(order,invoice,session);
  order.status='paid';order.recoveryRequired=false;order.recoveryReason=undefined;order.paidAt=date;order.invoice=invoice._id;order.payment=payment._id;order.accessStartsAt=start;order.accessExpiresAt=expires;order.grantNote=grantNote;await order.save({session});
  await one(Notification,{dedupeKey:'online-paid-'+String(order._id),type:grantNote?'payment_review':'payment_received',title:testMode?'Sandbox payment received':'Online payment received',message:`${user.name} purchased ${order.title} through ${order.provider}. ${order.currency} ${(order.amountMinor/100).toFixed(2)}.${grantNote?' '+grantNote:''}${user.status==='blocked'?' Customer account is blocked; contact the owner.':''}`,user:user._id,link:order.kind==='course'?'/admin?section=purchases':'/admin?section=subscriptions',entityId:String(payment._id)},session);
  await audit(null,{scope:'business',action:'payment.online_verified',targetUser:user._id,entityType:'checkout',entityId:String(order._id),changes:{provider:order.provider,environment:order.environment,amountMinor:order.amountMinor,currency:order.currency,invoice:String(invoice._id),verificationSource}},session);
  return publicOrder(order);
 });
}
export async function syncCheckout(orderId,{userId,capture=false,verificationSource='provider_api'}={}){
 const filter={_id:objectId(String(orderId)),...(userId?{user:objectId(String(userId))}:{})},order=await CheckoutOrder.findOne(filter);
 if(!order)throw businessError('Checkout order not found.',404);if(order.status==='paid')return publicOrder(order);
 if(!order.providerOrderId)return publicOrder(order);
 let evidence;
 if(order.provider==='paypal'&&capture){
  // The same database lease is used by provider switching. Before an external
  // capture, persist an uncertainty marker; expiry of a lease never erases it.
  const claimed=await claimCheckoutOperation(order._id);
  try{
   evidence=await paypalEvidence(claimed,{capture:!claimed.cancelRequestedAt,
    onBeforeCapture:async()=>{
     const result=await CheckoutOrder.updateOne({_id:claimed._id,operationClaim:claimed.operationClaim,cancelRequestedAt:{$exists:false}},
      {$set:{captureAttemptedAt:new Date()}});
     if(result.matchedCount!==1)throw businessError('Checkout changed before PayPal capture. Check payment status.',409);
    }});
  }finally{await releaseCheckoutOperation(claimed);}
 }else evidence=order.provider==='stripe'?await stripeEvidence(order):await paypalEvidence(order,{capture:false});
 if(evidence.state==='paid')return fulfillOnlineOrder(order._id,evidence,verificationSource);
 if(['expired','cancelled','failed'].includes(evidence.state))await CheckoutOrder.updateOne({_id:order._id,status:{$ne:'paid'}},{$set:{status:evidence.state,recoveryRequired:false},$unset:{recoveryReason:1}});
 const updated=await CheckoutOrder.findById(order._id);return publicOrder(updated);
}

/** Persistent operation lease: switching and app-initiated PayPal capture cannot
 * execute concurrently, even in different tabs, webhooks or server instances.
 */
async function claimCheckoutOperation(id){
 const token=crypto.randomUUID(),now=new Date();
 const claimed=await CheckoutOrder.findOneAndUpdate({_id:id,$or:[
  {operationClaimUntil:{$exists:false}},{operationClaimUntil:{$lt:now}}
 ]},{$set:{operationClaim:token,operationClaimUntil:new Date(+now+90000)}},{new:true})
  .select('+operationClaim +replacementKey');
 if(!claimed)throw businessError('This checkout is currently being checked. Please try the same action again shortly.',409);
 return claimed;
}
async function releaseCheckoutOperation(order){
 await CheckoutOrder.updateOne({_id:order._id,operationClaim:order.operationClaim},
  {$unset:{operationClaim:1,operationClaimUntil:1}});
}

/** Explicit user-requested release before choosing either payment method again.
 * The original request key and authenticated owner identify the checkout.
 * No charge, refund, invoice or entitlement is fabricated here.
 */
export async function releaseCheckout(req){
 const key=digest(String(req.user._id)+':'+requestKey(req));
 let original=await CheckoutOrder.findOne({requestKey:key,user:req.user._id});
 if(!original)throw businessError('The earlier checkout could not be identified yet. Check its status before paying again.',409);
 if(original.status==='paid')return {released:false,order:publicOrder(original)};
 if(!original.providerOrderId&&!CLOSED.has(original.status)){
  if(original.creationProtocolVersion===1&&!original.creationAttemptedAt){
   const closed=await CheckoutOrder.findOneAndUpdate({_id:original._id,creationProtocolVersion:1,creationAttemptedAt:{$exists:false},providerOrderId:{$exists:false},status:'creating',$or:[{creationClaimUntil:{$exists:false}},{creationClaimUntil:{$lt:new Date()}}]},
    {$set:{status:'cancelled',cancelRequestedAt:new Date(),recoveryRequired:false}},{new:true});
   if(!closed)throw businessError('The previous checkout is still being prepared. Retry the same action shortly.',409);original=closed;
  }else{
   await makeRemote(original,req.user);
   original=await CheckoutOrder.findOne({_id:original._id,user:req.user._id});
   if(!original?.providerOrderId&&!CLOSED.has(original?.status))throw businessError('The earlier checkout is still being reconciled. Check the same order.',409);
  }
 }
 const claimed=await claimCheckoutOperation(original._id);
 try{
  if(claimed.status==='paid')return {released:false,order:publicOrder(claimed)};
  if(!['failed','expired','cancelled'].includes(claimed.status)){
   const mark=await CheckoutOrder.updateOne({_id:claimed._id,operationClaim:claimed.operationClaim,status:{$ne:'paid'}},
    {$set:{cancelRequestedAt:claimed.cancelRequestedAt||new Date()}});
   if(mark.matchedCount!==1)throw businessError('Checkout changed while switching. Check its payment status.',409);
   claimed.cancelRequestedAt=claimed.cancelRequestedAt||new Date();
   const truth=claimed.provider==='stripe'?await closeStripeCheckout(claimed):await closePayPalCheckout(claimed);
   if(truth.state==='paid')return {released:false,order:await fulfillOnlineOrder(claimed._id,truth)};
   if(!['failed','expired','cancelled'].includes(truth.state))
    throw businessError('The earlier payment is still processing. Check its status before switching methods.',409);
   await CheckoutOrder.updateOne({_id:claimed._id,operationClaim:claimed.operationClaim,status:{$ne:'paid'}},
    {$set:{status:truth.state}});
  }
  // Retrying a release, including from a second tab, gets ONE replacement key.
  // Competing provider choices cannot create two replacements for the old order.
  const replacement=claimed.replacementKey||crypto.randomUUID();
  const closed=await CheckoutOrder.findOneAndUpdate({_id:claimed._id,operationClaim:claimed.operationClaim,
    status:{$in:['failed','expired','cancelled']}},
    {$set:{replacementKey:replacement}},{new:true}).select('+replacementKey');
  if(!closed){
   const latest=await CheckoutOrder.findById(claimed._id);
   if(latest?.status==='paid')return {released:false,order:publicOrder(latest)};
   throw businessError('Checkout status changed. Check My Billing before paying again.',409);
  }
  return {released:true,order:publicOrder(closed),replacementKey:closed.replacementKey};
 }finally{await releaseCheckoutOperation(claimed);}
}
