/** TEST-ONLY loopback API for the actual Next browser suite. No imports from the
 * production backend, database, SMTP or provider SDKs. Never deploy this file
 * as the application entrypoint. The production API never mounts these controls. */
import {createServer} from 'node:http';
import crypto from 'node:crypto';
export const CONTROL_HEADER='x-sa-ui-fixture';
export const CONTROL_VALUE='local-synthetic-tests-only';
const learner={id:'111111111111111111111111',_id:'111111111111111111111111',role:'student',name:'Jinjua Test',email:'learner@example.invalid',emailVerified:true};
const other={...learner,id:'333333333333333333333333',_id:'333333333333333333333333',name:'Second Learner',email:'other@example.invalid'};
const free={_id:'222222222222222222222222',slug:'free-demo',title:'Free Learning Test',accessType:'free',description:'Controlled test course.',published:true,instructor:'Academy Faculty'};
const paid={...free,_id:'444444444444444444444444',slug:'paid-demo',title:'Paid Learning Test',accessType:'one_time'};
const completionId='cccccccccccccccccccccccc';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export function createUiFixtureApi(){
 const sessions=new Map(),orders=new Map(),enrollments=new Map(),calls=[],invoices=[],payments=[],terms=[],notices=[];
 let sequence=0,config;
 function reset(){sessions.clear();sessions.set('b'.repeat(64),learner);orders.clear();enrollments.clear();calls.length=0;invoices.length=0;payments.length=0;terms.length=0;notices.length=0;sequence=0;config={createMode:'normal',createDelayMs:0,confirmDelayMs:0,confirmAfter:1,confirmFailures:0,certIssued:false};}
 reset();
 async function read(req){let text='';for await(const chunk of req){text+=chunk;if(text.length>50000)throw Error('Fixture input too large');}return text?JSON.parse(text):{};}
 function publicOrder(order){const {key,user,confirmationCount,approvalUrl,approved,replacementKey,...view}=order;return view;}
 function settle(order){
  if(order.status!=='pending')return;
  order.status='paid';order.paidAt=new Date().toISOString();order.accessStartsAt=order.paidAt;order.accessExpiresAt=new Date(Date.now()+365*86400000).toISOString();
  const invoice={_id:order._id,number:'SA-FIXTURE-'+order._id,user:order.user,title:order.title,kind:order.kind,currency:'USD',totalMinor:order.amountMinor,paidMinor:order.amountMinor,balanceMinor:0,status:'paid',effectiveStatus:'paid',testMode:true,paidAt:order.paidAt,createdAt:order.paidAt,accessStartsAt:order.accessStartsAt,accessExpiresAt:order.accessExpiresAt};
  invoices.push(invoice);payments.push({_id:order._id,user:order.user,invoice,amountMinor:order.amountMinor,currency:'USD',provider:order.provider,status:'paid',testMode:true,paidAt:order.paidAt,attachments:[]});notices.push({user:order.user,order:order._id,type:'purchase_confirmation',testOnly:true});
  if(order.kind==='membership'){terms.push({_id:order._id,user:order.user,plan:order.product,status:'active',effectiveStatus:'active',startsAt:order.accessStartsAt,endsAt:order.accessExpiresAt,durationMonths:12,priceMinor:order.amountMinor,currency:'USD',invoice,testMode:true});for(const course of [free,paid])enrollments.set(order.user+'|'+course.slug,course);}
  else enrollments.set(order.user+'|'+order.product,paid);
 }
 const server=createServer(async(req,res)=>{
  res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','private, no-store');
  const json=(body,status=200)=>{res.statusCode=status;res.end(JSON.stringify(body));};
  try{
   const url=new URL(req.url,'http://127.0.0.1'),path=url.pathname,method=req.method||'GET';
   if(path.startsWith('/__fixture/')){
    if(req.headers[CONTROL_HEADER]!==CONTROL_VALUE)return json({success:false},403);
    if(path==='/__fixture/reset'&&method==='POST'){reset();return json({success:true});}
    if(path==='/__fixture/config'&&method==='POST'){
     const body=await read(req);
     for(const k of ['createDelayMs','confirmDelayMs','confirmAfter','confirmFailures'])if(body[k]!==undefined){if(!Number.isSafeInteger(body[k])||body[k]<0||body[k]>10000)return json({success:false},400);config[k]=body[k];}
     if(body.createMode!==undefined){if(!['normal','lost','creating','expired'].includes(body.createMode))return json({success:false},400);config.createMode=body.createMode;}
     if(typeof body.certIssued==='boolean')config.certIssued=body.certIssued;
     return json({success:true});
    }
    if((path==='/__fixture/approve'||path==='/__fixture/settle')&&method==='POST'){const body=await read(req),order=[...orders.values()].find(o=>o._id===body.id);if(!order)return json({success:false},404);order.approved=true;if(path.endsWith('/settle'))settle(order);return json({success:true});}
    if(path==='/__fixture/state')return json({success:true,calls,orders:[...orders.values()].map(o=>({...publicOrder(o),user:o.user,key:o.key})),invoices,payments,terms,notices});
    return json({success:false},404);
   }
   const cookies=(req.headers.cookie||'').split(';').map(x=>x.trim()),tokens=cookies.filter(x=>x.startsWith('sa_student_v45=')).map(x=>x.slice(15));
   const user=cookies.includes('sa_logout_student=1')||req.headers['x-sa-portal']&&req.headers['x-sa-portal']!=='student'?null:tokens.map(t=>sessions.get(t)).find(Boolean)||null;
   calls.push({method,path,user:user?.id||null,key:req.headers['idempotency-key']||null});
   if(path==='/api/auth/session'){
    if(cookies.includes('sa_ui_unavailable=1'))return json({success:false,message:'Controlled SSR outage'},503);
    return json({success:true,user,enrollment:null,portal:'student',setupRequired:false});
   }
   if(path==='/api/auth/login'&&method==='POST'){
    const body=await read(req),account=body.email===learner.email?learner:body.email===other.email?other:null;
    if(!account||body.password!=='TestPassword123!')return json({success:false,message:'Invalid fixture credentials'},401);
    for(const token of tokens)sessions.delete(token);const token=crypto.randomBytes(32).toString('hex');sessions.set(token,account);
    res.setHeader('Set-Cookie',[`sa_student_v45=${token}; Path=/; HttpOnly; SameSite=Lax`,'sa_logout_student=; Path=/; Max-Age=0; SameSite=Lax']);
    return json({success:true,user:account,setupRequired:false});
   }
   if(path==='/api/auth/logout'&&method==='POST'){
    for(const token of tokens)sessions.delete(token);
    res.setHeader('Set-Cookie',['sa_student_v45=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax','sa_student_v45=; Path=/api; Max-Age=0; HttpOnly; SameSite=Lax','sa_logout_student=1; Path=/; Max-Age=604800; SameSite=Lax']);
    return json({success:true,signedOut:true,portal:'student'});
   }
   if(path==='/api/health'||path==='/api/health/ready')return json({success:true,testFixture:true});
   if(path==='/api/content/site')return json({success:true,content:{membershipPlans:[{name:'Annual',price:299,currency:'USD',durationMonths:12,active:true}],websiteContent:{text:{},images:[]},footerSocial:{}}});
   if(path==='/api/content/landing')return json({success:true,courses:[free,paid],team:[],reviews:[]});
   if(path==='/api/payments/methods')return json({success:true,methods:{stripe:{enabled:true,environment:'test'},paypal:{enabled:true,environment:'test'}}});
   if(!user)return json({success:false,code:'SESSION_REQUIRED',message:'Sign in to the test fixture'},401);
   if(path==='/api/payments/catalog'){
    const kind=url.searchParams.get('kind'),product=url.searchParams.get('product'),course=product===free.slug?free:paid;
    const valid=kind==='course'&&[free.slug,paid.slug].includes(product)||kind==='membership'&&product==='Annual';if(!valid)return json({success:false,message:'Fixture product not found'},404);
    return json({success:true,purchase:{kind,product,title:kind==='membership'?'Annual':course.title,free:kind==='course'&&course.accessType==='free',offers:kind==='course'&&course.accessType==='free'?[]:[{key:'annual',label:'12 months',durationMonths:12,currency:'USD',amountMinor:kind==='course'?14900:29900}]}});
   }
   if(path==='/api/payments/checkout/release'&&method==='POST'){
    const order=orders.get(user.id+':'+(req.headers['idempotency-key']||''));
    if(!order)return json({success:false,message:'Earlier checkout not identified'},409);
    if(order.status==='paid')return json({success:true,released:false,order:publicOrder(order)});
    if(order.status==='creating')return json({success:false,message:'Earlier payment is still being prepared'},409);
    order.cancellationRequested=true;
    if(order.status==='pending')order.status=order.provider==='stripe'?'expired':'cancelled';
    order.replacementKey ||= crypto.randomUUID();
    return json({success:true,released:true,order:publicOrder(order),replacementKey:order.replacementKey});
   }
   if(path==='/api/payments/checkout'&&method==='POST'){
    const body=await read(req),key=req.headers['idempotency-key'];
    if(!/^[-_a-zA-Z0-9]{16,128}$/.test(key||'')||!['stripe','paypal'].includes(body.provider))return json({success:false,message:'Invalid fixture checkout'},400);
    if(body.product===free.slug)return json({success:false,message:'Free courses do not need checkout'},409);
    if(body.optionKey!=='annual'||!(body.kind==='course'&&body.product===paid.slug||body.kind==='membership'&&body.product==='Annual'))return json({success:false,message:'Unknown stored fixture offer'},400);
    const mapKey=user.id+':'+key;let order=orders.get(mapKey);
    if(order&&(order.kind!==body.kind||order.product!==body.product||order.provider!==body.provider))return json({success:false,message:'Different purchase for this key'},409);
    if(order?.cancellationRequested||order&&['expired','cancelled','failed'].includes(order.status))return json({success:false,message:'Earlier checkout is closed'},409);
    if(!order){const id=(++sequence).toString(16).padStart(24,'0');order={_id:id,key,user:user.id,provider:body.provider,environment:'test',kind:body.kind,product:body.product,title:body.kind==='membership'?'Annual':paid.title,currency:'USD',amountMinor:body.kind==='membership'?29900:14900,status:config.createMode==='creating'?'creating':config.createMode==='expired'?'expired':'pending',confirmationCount:0,approvalUrl:body.provider==='stripe'?'https://checkout.stripe.com/c/pay/sa-ui-'+id:'https://www.sandbox.paypal.com/checkoutnow?token=sa-ui-'+id};orders.set(mapKey,order);}
    await pause(config.createDelayMs);
    if(config.createMode!=='normal')return json({success:false,message:'Controlled lost checkout response'},504);
    return json({success:true,order:publicOrder(order),...(order.status==='pending'?{url:order.approvalUrl}:{})});
   }
   if(path==='/api/payments/checkout-status'){
    const order=orders.get(user.id+':'+(req.headers['idempotency-key']||''));
    return json({success:true,found:!!order,order:order?publicOrder(order):null,url:order?.status==='pending'&&!order.cancellationRequested?order.approvalUrl:null,creationPending:order?.status==='creating'});
   }
   const match=path.match(/^\/api\/payments\/orders\/([a-f0-9]{24})(\/confirm)?$/);
   if(match){
    const order=[...orders.values()].find(o=>o._id===match[1]&&o.user===user.id);if(!order)return json({success:false,message:'Checkout not found'},404);
    if(match[2]&&method==='POST'){
     await pause(config.confirmDelayMs);if(config.confirmFailures>0){config.confirmFailures--;return json({success:false,message:'Controlled provider status outage'},503);}
     if(order.status==='pending'&&!order.cancellationRequested&&order.approved&&++order.confirmationCount>=config.confirmAfter)settle(order);
    }
    return json({success:true,order:publicOrder(order)});
   }
   const billing=path.match(/^\/api\/payments\/mine\/(plans|invoices|payments)$/);
   if(billing){const items=(billing[1]==='plans'?terms:billing[1]==='invoices'?invoices:payments).filter(x=>x.user===user.id);return json({success:true,items,total:items.length,page:1,pageSize:20});}
   if(path==='/api/content/team')return json({success:true,team:[]});
   if(path==='/api/content/events')return json({success:true,events:[]});
   if(path==='/api/reviews')return json({success:true,reviews:[]});
   if(path==='/api/courses')return json({success:true,courses:[free,paid]});
   if(path==='/api/courses/enrolled/mine')return json({success:true,courses:[...enrollments.entries()].filter(([k])=>k.startsWith(user.id+'|')).map(([,c])=>({...c,progress:0}))});
   if(path==='/api/certificates/status')return json({success:true,items:[{_id:completionId,courseSlug:free.slug,courseTitle:free.title,status:config.certIssued?'issued':'pending',...(config.certIssued?{certificateNumber:'SA-UI-FIXTURE'}:{})}]});
   const courseMatch=path.match(/^\/api\/courses\/(free-demo|paid-demo)(\/(enroll|learn))?$/);
   if(courseMatch){
    const course=courseMatch[1]===free.slug?free:paid,key=user.id+'|'+course.slug;
    if(!courseMatch[2])return json({success:true,course,modules:[]});
    if(courseMatch[3]==='enroll'&&method==='POST'){
     if(course.accessType!=='free'&&!enrollments.has(key)&&!terms.some(t=>t.user===user.id))return json({success:false,message:'Payment required'},403);
     enrollments.set(key,course);return json({success:true,enrollment:{user:user.id,courseSlug:course.slug}});
    }
    if(courseMatch[3]==='learn'){if(!enrollments.has(key)&&course.accessType!=='free')return json({success:false,message:'Enrollment required'},403);return json({success:true,course,modules:[],completedLessonIds:[],attempt:{number:1}});}
   }
   if(path==='/api/payments/membership-status')return json({success:true,membershipActive:terms.some(t=>t.user===user.id)});
   if(path.startsWith('/api/notifications')||path.startsWith('/api/student-notifications'))return json({success:true,items:[],unread:0});
   return json({success:false,message:'UI fixture endpoint not provided: '+path},404);
  }catch(error){json({success:false,message:'Fixture error: '+error.message},500);}
 });
 return server;
}
