/** Actual Next/browser + local synthetic commerce fixture. Provider URLs are
 * intercepted with static fake pages. These are NOT Stripe/PayPal sandbox calls
 * and cannot prove provider signatures, database transactions or inbox delivery. */
import {test,expect,type BrowserContext,type APIRequestContext,type Page} from '@playwright/test';
import {syntheticProviderDocument,syntheticProviderIdentity,matchingFixtureOrder,SYNTHETIC_PROVIDER_HEADING} from './helpers/fixtures.mjs';
const origin='http://127.0.0.1:3108',api='http://127.0.0.1:5109';
async function control(request:APIRequestContext,path:string,body?:object){
 const response=body?await request.post(api+'/__fixture/'+path,{headers:{'x-sa-ui-fixture':'local-synthetic-tests-only'},data:body}):await request.get(api+'/__fixture/'+path,{headers:{'x-sa-ui-fixture':'local-synthetic-tests-only'}});
 expect(response.ok()).toBe(true);return response.json();
}
async function signIn(context:BrowserContext,email='learner@example.invalid'){
 const response=await context.request.post(origin+'/api/auth/login',{headers:{'X-SA-Portal':'student','X-SA-CSRF':'1'},data:{email,password:'TestPassword123!'}});expect(response.ok()).toBe(true);
}
function errors(page:Page){const list:string[]=[];page.on('pageerror',error=>list.push(error.message));page.on('console',m=>{if(m.type()==='error'&&/hydration|server rendered HTML|didn't match/i.test(m.text()))list.push(m.text());});return list;}
async function orders(request:APIRequestContext){return (await control(request,'state')).orders;}
async function approve(page:Page,request:APIRequestContext){
 // A click finishes before its asynchronous order-creation request. Synchronize
 // with the observed provider document, then select THAT order, not list.at(-1).
 await expect(page.getByRole('heading',{name:SYNTHETIC_PROVIDER_HEADING,exact:true})).toBeVisible();
 const identity=syntheticProviderIdentity(page.url());expect(identity).not.toBeNull();
 await expect.poll(async()=>!!matchingFixtureOrder(await orders(request),identity)).toBe(true);
 const order=matchingFixtureOrder<any>(await orders(request),identity);expect(order).toBeTruthy();
 expect(order.status).toBe('pending');
 await control(request,'approve',{id:order._id});await page.getByRole('link',{name:'Approve fixture payment',exact:true}).click();
 return order;
}
test.beforeEach(async({request,context})=>{
 await control(request,'reset',{});
 await context.route('**/*',async route=>{
  const u=new URL(route.request().url());
  if(u.origin===origin)return route.continue();
  const document=route.request().resourceType()==='document'?syntheticProviderDocument(u.href):null;
  if(document)return route.fulfill(document);
  return route.abort(); // No external scripts, analytics or actual provider calls.
 });
});
for(const width of [390,1440])for(const provider of ['stripe','paypal'])for(const kind of ['course','membership'])test(`${provider} ${kind} at ${width}px: one checkout, verified fixture return, owned invoice`,async({page,context,request})=>{
 const observed=errors(page);await page.setViewportSize({width,height:960});await signIn(context);
 await page.goto(kind==='course'?'/checkout?course=paid-demo':'/checkout?plan=Annual');
 const button=page.locator('button.paymentMethod.'+provider);await expect(button).toBeEnabled();
 await button.evaluate(el=>{(el as HTMLButtonElement).click();(el as HTMLButtonElement).click();});
 await expect(page.getByRole('heading',{name:'Synthetic payment provider — no real money'})).toBeVisible();
 const before=await control(request,'state');expect(before.orders).toHaveLength(1);expect(before.invoices).toHaveLength(0);expect(before.calls.filter((c:any)=>c.path==='/api/payments/checkout'&&c.method==='POST')).toHaveLength(1);
 const order=await approve(page,request);await expect(page.getByRole('heading',{name:'You’re ready to learn.'})).toBeVisible();
 const after=await control(request,'state');expect(after.orders[0].status).toBe('paid');expect(after.invoices).toHaveLength(1);expect(after.payments).toHaveLength(1);expect(after.notices).toHaveLength(1);expect(after.terms).toHaveLength(kind==='membership'?1:0);
 expect(after.invoices[0].totalMinor).toBe(kind==='course'?14900:29900);expect(after.invoices[0].user).toBe('111111111111111111111111');
 expect(await page.evaluate(()=>Object.keys(sessionStorage).filter(k=>k.startsWith('sa-checkout-active:')))).toHaveLength(0);
 await page.goto('/billing?section=invoices');await expect(page.getByRole('heading',{name:'SA-FIXTURE-'+order._id,exact:true})).toBeVisible();expect(observed).toEqual([]);
});
test('lost creation response recovers with the original key and no second purchase POST',async({page,context,request})=>{
 await control(request,'config',{createMode:'lost'});await signIn(context);await page.goto('/checkout?course=paid-demo');await page.locator('button.paymentMethod.stripe').click();
 await expect(page.getByRole('heading',{name:'Synthetic payment provider — no real money'})).toBeVisible();
 const state=await control(request,'state'),posts=state.calls.filter((c:any)=>c.path==='/api/payments/checkout'&&c.method==='POST'),reads=state.calls.filter((c:any)=>c.path==='/api/payments/checkout-status');
 expect(posts).toHaveLength(1);expect(reads.length).toBeGreaterThan(0);expect(reads.every((x:any)=>x.key===posts[0].key)).toBe(true);expect(state.orders).toHaveLength(1);expect(state.payments).toHaveLength(0);
});
test('unknown checkout survives refresh and server refuses a new payment until the old checkout is identified',async({page,context,request})=>{
 await control(request,'config',{createMode:'creating'});await signIn(context);await page.goto('/checkout?course=paid-demo');await page.locator('button.paymentMethod.stripe').click();
 await expect(page.getByRole('button',{name:'Check existing checkout',exact:true})).toBeVisible();await expect(page.locator('button.paymentMethod.paypal')).toBeEnabled();
 await page.reload();await expect(page.getByRole('button',{name:'Check existing checkout',exact:true})).toBeVisible();await expect(page.locator('button.paymentMethod.paypal')).toBeEnabled();
 await page.locator('button.paymentMethod.paypal').click();
 await expect(page.locator('button.paymentMethod.paypal')).toBeEnabled();
 await page.getByRole('button',{name:'Check existing checkout',exact:true}).click();await expect(page.getByRole('button',{name:'Start a new checkout',exact:true})).toHaveCount(0);
 const state=await control(request,'state');expect(state.orders).toHaveLength(1);expect(state.payments).toHaveLength(0);expect(state.calls.filter((c:any)=>c.path==='/api/payments/checkout'&&c.method==='POST')).toHaveLength(1);
});
test('only a server-confirmed closed checkout plus an explicit click permits a new key',async({page,context,request})=>{
 await control(request,'config',{createMode:'expired'});await signIn(context);await page.goto('/checkout?course=paid-demo');await page.locator('button.paymentMethod.stripe').click();
 const fresh=page.getByRole('button',{name:'Start a new checkout',exact:true});await expect(fresh).toBeVisible();const previous=(await orders(request))[0];
 await control(request,'config',{createMode:'normal'});page.once('dialog',dialog=>dialog.accept());await fresh.click();await page.locator('button.paymentMethod.paypal').click();
 await expect(page.getByRole('heading',{name:'Synthetic payment provider — no real money'})).toBeVisible();const current=await orders(request);expect(current).toHaveLength(2);expect(current[1].key).not.toBe(previous.key);
});
test('provider cancellation is a read-only status check, not a capture or automatic retry',async({page,context,request})=>{
 await signIn(context);await page.goto('/checkout?course=paid-demo');await page.locator('button.paymentMethod.paypal').click();await page.getByRole('link',{name:'Cancel fixture payment',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Check your existing checkout.',exact:true})).toBeVisible();await page.getByRole('button',{name:'Check payment status',exact:true}).click();
 const state=await control(request,'state');expect(state.calls.some((c:any)=>c.path.endsWith('/confirm'))).toBe(false);expect(state.payments).toHaveLength(0);expect(state.orders).toHaveLength(1);
});
test('slow pending confirmation updates the same document without another checkout',async({page,context,request})=>{
 await control(request,'config',{confirmAfter:2});await signIn(context);await page.goto('/checkout?plan=Annual');await page.locator('button.paymentMethod.paypal').click();await approve(page,request);
 await expect(page.getByRole('button',{name:'Check payment status',exact:true})).toBeVisible();const stamp=await page.evaluate(()=>performance.timeOrigin);
 await expect(page.getByRole('heading',{name:'You’re ready to learn.'})).toBeVisible({timeout:12000});expect(await page.evaluate(()=>performance.timeOrigin)).toBe(stamp);
 const state=await control(request,'state');expect(state.orders).toHaveLength(1);expect(state.payments).toHaveLength(1);expect(state.terms).toHaveLength(1);
});
test('temporary provider confirmation outage offers retry of status, not another purchase',async({page,context,request})=>{
 await control(request,'config',{confirmFailures:1});await signIn(context);await page.goto('/checkout?course=paid-demo');await page.locator('button.paymentMethod.stripe').click();await approve(page,request);
 const outage=page.locator('.checkoutReturnCard').getByRole('alert').filter({hasText:'Controlled provider status outage'});
 await expect(outage).toHaveCount(1);await expect(outage).toContainText('Controlled provider status outage');await page.getByRole('button',{name:'Retry status check',exact:true}).click();await expect(page.getByRole('heading',{name:'You’re ready to learn.'})).toBeVisible();
 const state=await control(request,'state');expect(state.orders).toHaveLength(1);expect(state.payments).toHaveLength(1);expect(state.calls.filter((c:any)=>c.path==='/api/payments/checkout'&&c.method==='POST')).toHaveLength(1);
});
test('one student cannot read or confirm another students checkout or invoice',async({page,context,request,browser})=>{
 await signIn(context);await page.goto('/checkout?course=paid-demo');await page.locator('button.paymentMethod.stripe').click();const order=await approve(page,request);await expect(page.getByRole('heading',{name:'You’re ready to learn.'})).toBeVisible();
 const second=await browser.newContext();try{
  await signIn(second,'other@example.invalid');
  for(const suffix of ['', '/confirm']){const response=await second.request.fetch(origin+'/api/payments/orders/'+order._id+suffix,{method:suffix?'POST':'GET',headers:{'X-SA-Portal':'student','X-SA-CSRF':'1'}});expect(response.status()).toBe(404);}
  const invoices=await second.request.get(origin+'/api/payments/mine/invoices',{headers:{'X-SA-Portal':'student'}});expect((await invoices.json()).items).toHaveLength(0);
 }finally{await second.close();}
});
test('provider Back preserves the original checkout and does not automatically create another order',async({page,context,request})=>{
 await signIn(context);await page.goto('/checkout?course=paid-demo');await page.locator('button.paymentMethod.stripe').click();await expect(page.getByRole('heading',{name:'Synthetic payment provider — no real money'})).toBeVisible();
 const original=(await orders(request))[0];await page.goBack();await expect(page).toHaveURL(origin+'/checkout?course=paid-demo');
 await expect(page.getByRole('button',{name:'Check existing checkout',exact:true})).toBeEnabled();await expect(page.locator('button.paymentMethod.paypal')).toBeEnabled();
 await page.getByRole('button',{name:'Check existing checkout',exact:true}).click();await expect(page.getByRole('heading',{name:'Synthetic payment provider — no real money'})).toBeVisible();
 const state=await control(request,'state');expect(state.orders).toHaveLength(1);expect(state.orders[0].key).toBe(original.key);expect(state.calls.filter((c:any)=>c.path==='/api/payments/checkout'&&c.method==='POST')).toHaveLength(1);
});
test('paid return refresh reuses the settled order and cannot duplicate invoice, payment or notification',async({page,context,request})=>{
 await signIn(context);await page.goto('/checkout?plan=Annual');await page.locator('button.paymentMethod.paypal').click();await approve(page,request);await expect(page.getByRole('heading',{name:'You’re ready to learn.'})).toBeVisible();
 await page.reload();await expect(page.getByRole('heading',{name:'You’re ready to learn.'})).toBeVisible();
 const state=await control(request,'state');for(const field of ['orders','invoices','payments','terms','notices'])expect(state[field]).toHaveLength(1);
});

// Fixture self-checks: keep Unicode text exact and reject accidental network calls.
for(const provider of ['stripe','paypal'])test(`synthetic ${provider} document preserves UTF-8 heading and both return links`,async({page,context,request})=>{
 await signIn(context);
 const created=await context.request.post(origin+'/api/payments/checkout',{
  headers:{'X-SA-Portal':'student','X-SA-CSRF':'1','Idempotency-Key':'fixture-charset-'+provider+'-123456789'},
  data:{kind:'course',product:'paid-demo',optionKey:'annual',provider}
 });
 expect(created.ok()).toBe(true);const checkout=await created.json();
 const response=await page.goto(checkout.url);expect(response).not.toBeNull();
 expect(response!.headers()['content-type']).toContain('charset=utf-8');
 await expect(page.getByRole('heading',{name:SYNTHETIC_PROVIDER_HEADING,exact:true})).toBeVisible();
 expect(await page.evaluate(()=>document.characterSet.toUpperCase())).toBe('UTF-8');
 await expect(page.getByRole('link',{name:'Approve fixture payment',exact:true})).toHaveAttribute('href',origin+'/checkout/return?order='+checkout.order._id);
 await expect(page.getByRole('link',{name:'Cancel fixture payment',exact:true})).toHaveAttribute('href',origin+'/checkout/return?order='+checkout.order._id+'&cancelled=1');
 const state=await control(request,'state');expect(state.payments).toHaveLength(0);
});
test('delayed creation is observed before approval and still settles exactly one order',async({page,context,request})=>{
 await control(request,'config',{createDelayMs:400});await signIn(context);
 await page.goto('/checkout?course=paid-demo');await page.locator('button.paymentMethod.stripe').click();
 const order=await approve(page,request);
 await expect(page.getByRole('heading',{name:'You’re ready to learn.'})).toBeVisible();
 const state=await control(request,'state');expect(state.orders).toHaveLength(1);
 expect(state.invoices).toHaveLength(1);expect(state.payments).toHaveLength(1);
 expect(state.payments[0]._id).toBe(order._id);
 expect(state.calls.filter((c:any)=>c.path==='/api/payments/checkout'&&c.method==='POST')).toHaveLength(1);
});

// V60.14 provider reselection: the explicit second click first releases the
// original owned checkout. Back/Cancel alone never performs a capture or release.
for(const width of [390,1440])for(const oldProvider of ['stripe','paypal'])for(const kind of ['course','membership'])
test(`${oldProvider} ${kind} at ${width}px: Back/Cancel permits verified switch and only replacement can settle`,async({page,context,request})=>{
 await page.setViewportSize({width,height:960});await signIn(context);
 const target=kind==='course'?'/checkout?course=paid-demo':'/checkout?plan=Annual',newProvider=oldProvider==='stripe'?'paypal':'stripe';
 await page.goto(target);await page.locator('button.paymentMethod.'+oldProvider).click();
 await expect(page.getByRole('heading',{name:SYNTHETIC_PROVIDER_HEADING,exact:true})).toBeVisible();
 const original=(await orders(request))[0];
 if(width===390){
  await page.getByRole('link',{name:'Cancel fixture payment',exact:true}).click();
  await expect(page.getByRole('link',{name:'Choose payment method',exact:true})).toBeVisible();
  await page.getByRole('link',{name:'Choose payment method',exact:true}).click();
 }else await page.goBack();
 await expect(page).toHaveURL(origin+target);
 const before=await control(request,'state');expect(before.payments).toHaveLength(0);
 expect(before.calls.filter((c:any)=>c.path==='/api/payments/checkout/release')).toHaveLength(0);
 const choose=page.locator('button.paymentMethod.'+newProvider);await expect(choose).toBeEnabled();await choose.click();
 await expect(page.getByRole('heading',{name:SYNTHETIC_PROVIDER_HEADING,exact:true})).toBeVisible();
 const switched=await control(request,'state');expect(switched.orders).toHaveLength(2);
 expect(switched.orders[0].status).toBe(oldProvider==='stripe'?'expired':'cancelled');expect(switched.orders[1].provider).toBe(newProvider);
 const release=switched.calls.filter((c:any)=>c.path==='/api/payments/checkout/release');expect(release).toHaveLength(1);expect(release[0].key).toBe(original.key);
 // Simulate returning from a stale provider tab after replacement was selected.
 await control(request,'approve',{id:original._id});
 const late=await context.request.post(origin+'/api/payments/orders/'+original._id+'/confirm',{headers:{'X-SA-Portal':'student','X-SA-CSRF':'1'}});
 expect(late.ok()).toBe(true);expect((await late.json()).order.status).toBe(oldProvider==='stripe'?'expired':'cancelled');
 expect((await control(request,'state')).payments).toHaveLength(0);
 await approve(page,request);await expect(page.getByRole('heading',{name:'You’re ready to learn.'})).toBeVisible();
 const finished=await control(request,'state');for(const key of ['payments','invoices','notices'])expect(finished[key]).toHaveLength(1);
 expect(finished.payments[0].provider).toBe(newProvider);
});
test('payment method can switch back a second time without duplicate settlement',async({page,context,request})=>{
 await signIn(context);await page.goto('/checkout?plan=Annual');
 for(const provider of ['stripe','paypal','stripe']){
  await page.locator('button.paymentMethod.'+provider).click();await expect(page.getByRole('heading',{name:SYNTHETIC_PROVIDER_HEADING,exact:true})).toBeVisible();
  if((await orders(request)).length<3)await page.goBack();
 }
 await approve(page,request);await expect(page.getByRole('heading',{name:'You’re ready to learn.'})).toBeVisible();
 const state=await control(request,'state');expect(state.orders).toHaveLength(3);expect(state.payments).toHaveLength(1);expect(state.terms).toHaveLength(1);
});
test('another student cannot release an owned checkout or obtain its replacement key',async({page,context,request,browser})=>{
 await signIn(context);await page.goto('/checkout?course=paid-demo');await page.locator('button.paymentMethod.stripe').click();
 await expect(page.getByRole('heading',{name:SYNTHETIC_PROVIDER_HEADING,exact:true})).toBeVisible();const original=(await orders(request))[0];
 const second=await browser.newContext();try{
  await signIn(second,'other@example.invalid');
  const response=await second.request.post(origin+'/api/payments/checkout/release',{headers:{'X-SA-Portal':'student','X-SA-CSRF':'1','Idempotency-Key':original.key},data:{}});
  expect(response.status()).toBe(409);expect((await response.json()).replacementKey).toBeUndefined();
  expect((await orders(request))[0].status).toBe('pending');
 }finally{await second.close();}
});
