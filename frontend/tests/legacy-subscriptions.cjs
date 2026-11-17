const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs');
const origin=process.env.LEGACY_PORTAL_ORIGIN||'http://127.0.0.1:4180';
const out=process.env.LEGACY_PORTAL_OUTPUT || 'artifacts/legacy-portal-ui';fs.mkdirSync(out,{recursive:true});
const system={id:1,key:'PMS',nameAr:'نظام إدارة المنتجات',name:'PMS'};
const plan={id:1,key:'BASIC',name:'Basic',nameAr:'أساسي',systemId:1,system};
const customer={id:9,name:'Synthetic legacy customer',email:'legacy@example.invalid',downloadEnabled:true,requestedPlanId:null};
const legacy={id:3,licenseKey:'SYNTHETI********5678',status:'ACTIVE',isTrial:false,startsAt:'2026-11-05T01:06:52Z',expiresAt:'2026-12-05T01:06:52Z',maxDevices:1,version:7,devices:[{id:1,deviceName:'Synthetic device',status:'ACTIVE'}],plan};
async function scenario(browser,kind){
 const context=await browser.newContext({viewport:{width:390,height:844}}),errors=[],requests=[];
 const existingSub={id:1,customerId:9,planId:1,plan,status:'ACTIVE',price:150000,currency:'EGP',startsAt:'2026-11-05',expiresAt:'2026-12-05',billingInterval:'MONTHLY',licenses:[{...legacy,id:4}]};
 let overviewFailed=kind==='overview-error';
 await context.route('**/*',async route=>{
  const r=route.request(),u=new URL(r.url());
  if(u.pathname.startsWith('/api/v1/')){
   requests.push({path:u.pathname,method:r.method()});let status=200,data={};
   if(u.pathname.endsWith('/auth/refresh'))status=401;
   else if(u.pathname.endsWith('/portal/login'))data={customer,accessToken:'synthetic-session'};
   else if(u.pathname.endsWith('/portal/me'))data=customer;
   else if(u.pathname.endsWith('/portal/billing-subscriptions'))data={subscriptions:kind==='mixed'?[existingSub]:[],unlinkedLicenseCount:kind==='empty'?0:1};
   else if(u.pathname.endsWith('/portal/overview')){
    if(overviewFailed){status=503;data={error:{message:'Synthetic offline'}};}
    else data={customer,licenses:kind==='empty'?[]:kind==='mixed'?[legacy,{...legacy,id:4}]:[{...legacy,isTrial:kind==='trial'}],canDownload:true,latestRelease:null};
   }
   else if(u.pathname.endsWith('/portal/licenses'))data={data:[{id:3,licenseKey:'SYNTHETIC-FULL-KEY-12345678'}]};
   return route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
  }
  if(u.origin===origin)return route.continue();return route.abort();
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'/portal/my-subscriptions');await page.getByLabel('البريد الإلكتروني',{exact:true}).fill(customer.email);await page.getByLabel('كلمة المرور',{exact:true}).fill('Synthetic-Password-42!');await page.getByRole('button',{name:'دخول',exact:true}).click();
 await page.getByRole('heading',{name:'اشتراكاتي',exact:true}).waitFor();
 if(kind==='empty'){await page.getByRole('link',{name:'تصفح الأنظمة والاشتراكات'}).waitFor();assert.equal(await page.getByRole('article').count(),0);}
 else if(kind==='overview-error'){
  await page.getByText('تعذر تحميل التراخيص القديمة. لم تتغير بيانات حسابك.',{exact:true}).waitFor();
  assert.equal((await page.locator('main').innerText()).includes('ليس لديك اشتراكات بعد'),false);
  overviewFailed=false;await page.getByRole('button',{name:'إعادة تحميل التراخيص'}).click();await page.getByRole('article',{name:'ترخيص قديم #3',exact:true}).waitFor();
 }else{
  await page.locator('main').getByText(/قديم/).first().waitFor();
  assert.equal((await page.locator('main').innerText()).includes('ليس لديك اشتراكات بعد'),false,'Existing unlinked licence must not be presented as an empty account');
  await page.getByRole('article',{name:'ترخيص قديم #3',exact:true}).waitFor();
  assert.equal(await page.getByRole('article',{name:'ترخيص قديم #4',exact:true}).count(),0,'Linked licences must not appear twice');
  assert.equal((await page.getByRole('article',{name:'ترخيص قديم #3',exact:true}).innerText()).includes('SYNTHETI********5678'),true);
  assert.equal(await page.getByRole('article',{name:'ترخيص قديم #3',exact:true}).getByRole('link',{name:'تنزيل نسخة النظام'}).getAttribute('href'),'/portal/download?planKey=BASIC');
  if(kind==='legacy'){await page.getByRole('button',{name:'إظهار كود التفعيل'}).click();await page.getByText('SYNTHETIC-FULL-KEY-12345678',{exact:true}).waitFor();await page.getByRole('button',{name:'إخفاء كود التفعيل'}).click();await page.screenshot({path:out+'/legacy-mobile.png',fullPage:true});}
 }
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);assert.deepEqual(errors,[]);
 assert.equal(requests.some(x=>x.method!=='GET'&&!x.path.endsWith('/auth/refresh')&&!x.path.endsWith('/portal/login')),false);
 await context.close();return kind;
}
(async()=>{const browser=await chromium.launch({...(process.env.CHROME_PATH ? {executablePath:process.env.CHROME_PATH} : {}),headless:true});try{const passed=[];for(const kind of ['legacy','trial','mixed','empty','overview-error'])passed.push(await scenario(browser,kind));const result={Cases:passed,Mobile390NoOverflow:true,NoCustomerBusinessMutations:true,ProductionRequestsBlocked:true,Origin:origin};fs.writeFileSync(out+'/RESULT.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));}finally{await browser.close();}})().catch(e=>{console.error(e.message);process.exitCode=1;});
