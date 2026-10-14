/* Run: node tests/smoke.cjs. Start site on http://127.0.0.1:8765 first.
   Requires Playwright + Chromium. All AI requests are intercepted; no keys leave this machine. */
const {chromium} = require('playwright');
const fs = require('fs');
const assert = require('node:assert/strict');
const path = require('path');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const demo = new Function(source.slice(source.indexOf('  var DEMO ='), source.indexOf('  var cur =')) + '\nreturn DEMO;')().ru;
const notes = {...demo.notes, case: {title:demo.notes.caseTitle,text:demo.notes.caseText}};
(async()=>{
 const browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH || (fs.existsSync('/usr/local/bin/chromium') ? '/usr/local/bin/chromium' : undefined),headless:true,args:['--no-sandbox']});
 const context = await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
 const page = await context.newPage(); const errors = []; const passed = [];
 page.on('pageerror', e=>errors.push(e.message));
 page.on('dialog', d=>d.accept());
 await page.route('https://cdn.jsdelivr.net/**', r=>r.abort());
 await page.route('https://cdnjs.cloudflare.com/**', r=>r.abort());
 let mode='success', requests=[];
 await page.route('https://discovery-api.intern-ai.org.cn/v1/chat/completions', async r=>{
   const data=r.request().postDataJSON(); requests.push({data,headers:r.request().headers()});
   if(mode==='slow') { await new Promise(resolve=>setTimeout(resolve,700)); }
   if(mode==='401') return r.fulfill({status:401,body:'{}'});
   if(mode==='429') return r.fulfill({status:429,body:'{}'});
   if(mode==='500') return r.fulfill({status:500,body:'{}'});
   if(mode==='network') return r.abort('failed');
   let prompt = data.messages[0].content;
   let value= prompt.includes('Составь поурочный план') ? demo.plan : prompt.includes('Напиши опорный конспект') ? notes : prompt.includes('Сделай шесть слайдов') ? demo.slides : prompt.includes('Разбери, как он устроен') ? {name:'Тест',docType:'plan',structure:[{title:'Введение',purpose:'Начало',approxMinutes:5}]} : 'OK';
   if(mode==='bad') value={};
   return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({choices:[{message:{content:typeof value==='string'?value:JSON.stringify(value)},finish_reason:mode==='truncated'?'length':'stop'}]})});
 });
 const check=async(name,fn)=>{await fn();passed.push(name);console.log('PASS',name)};
 await page.goto('http://127.0.0.1:8765');
 await check('Initial view, no hidden progress',async()=>{assert(await page.locator('#v-new').isVisible());assert(!(await page.locator('#genProg').isVisible()));assert(!(await page.locator('#anaProg').isVisible()));});
 await check('Unconfigured generation gives actionable error',async()=>{await page.click('#genGo');assert.match(await page.locator('#genErr').innerText(),/настройках/)});
 await page.click('#t-api');
 await check('Discovery default, unrestricted key format, session-only storage',async()=>{
  assert.equal(await page.inputValue('#apiBase'),'https://discovery-api.intern-ai.org.cn/v1');
  await page.fill('#orKey','test-any-format-not-a-real-secret');await page.fill('#orModel','provider/model');await page.click('#orSave');
  assert.equal(await page.evaluate(()=>localStorage.getItem('or_key')),null);
  assert.equal(await page.evaluate(()=>sessionStorage.getItem('su_api_key')),'test-any-format-not-a-real-secret');
 });
 await check('Connection check sends selected model and key only to selected endpoint',async()=>{
  await page.click('#apiTest');await page.waitForFunction(()=>document.querySelector('#apiMessage').textContent.includes('работает'));
  assert.equal(requests.at(-1).data.model,'provider/model');assert.equal(requests.at(-1).headers.authorization,'Bearer test-any-format-not-a-real-secret');assert.equal(requests.at(-1).data.stream,false);
 });
 await check('Key visibility toggle',async()=>{await page.click('#keyToggle');assert.equal(await page.getAttribute('#orKey','type'),'text');await page.click('#keyToggle');assert.equal(await page.getAttribute('#orKey','type'),'password')});
 await check('Reject unsafe API URLs',async()=>{await page.fill('#apiBase','http://example.com/v1');await page.click('#orSave');assert.match(await page.locator('#apiMessage').innerText(),/Проверьте/);await page.fill('#apiBase','https://discovery-api.intern-ai.org.cn/v1')});
 for (let state of ['401','429','500','network','truncated']) await check('Readable API error: '+state, async()=>{
   mode=state;await page.click('#apiTest');await page.waitForFunction(()=>!document.querySelector('#apiTest').disabled);
   assert.match(await page.locator('#apiMessage').innerText(), {'401':/401\/403/,'429':/лимит/,'500':/500/,network:/CORS/,truncated:/обрезан/}[state]);
 });
 mode='success';
 await check('Keyboard navigation',async()=>{await page.focus('#t-api');await page.keyboard.press('Home');assert.equal(await page.getAttribute('#t-new','aria-selected'),'true');await page.keyboard.press('End');assert.equal(await page.getAttribute('#t-api','aria-selected'),'true')});
 await check('Template filtering, explicit no-template selection persists',async()=>{
  await page.click('#t-new');assert.equal(await page.locator('#fNotesTpl option').count(),1);await page.selectOption('#fPlanTpl','');await page.click('[data-lang=kk]');assert.equal(await page.inputValue('#fPlanTpl'),'');await page.click('[data-lang=ru]');
 });
 await check('Three-step generation and save on reload',async()=>{
  await page.click('#genGo');await page.waitForSelector('#v-res:not([hidden])');
  assert.equal(requests.slice(-3).length,3);assert.equal(await page.locator('[data-p="plan.topic"]').innerText(),demo.plan.topic);
  await page.locator('[data-p="plan.topic"]').fill('Изменённый результат');await page.reload();await page.click('#t-res');assert.equal(await page.locator('[data-p="plan.topic"]').innerText(),'Изменённый результат');
 });
 await check('Malformed model response rejected, old result retained',async()=>{
  mode='bad';await page.click('#t-new');await page.click('#genGo');await page.waitForSelector('#genErr:not([hidden])');assert.match(await page.locator('#genErr').innerText(),/формат/);await page.click('#t-res');assert.equal(await page.locator('[data-p="plan.topic"]').innerText(),'Изменённый результат');
 });
 await check('Cancellation and busy buttons survive language switching',async()=>{
   mode='slow';await page.click('#t-new');await page.click('#genGo');assert(await page.locator('#genGo').isDisabled());await page.click('[data-lang=kk]');assert(await page.locator('#genGo').isDisabled());await page.click('#genStop');await page.waitForFunction(()=>!document.querySelector('#genGo').disabled);assert(!(await page.locator('#genProg').isVisible()));await page.click('[data-lang=ru]');
 });
 mode='success';
 await check('Template analysis and persistence',async()=>{
   await page.click('#t-lib');await page.fill('#src','Учебный текст образца. '.repeat(30));await page.click('#anaGo');await page.waitForFunction(()=>!document.querySelector('#anaGo').disabled);assert.equal(await page.locator('#tplList article').count(),2);assert(!(await page.locator('#anaProg').isVisible()));
 });
 await check('Corrupt template import sanitized',async()=>{
  await page.locator('#libImport').setInputFiles({name:'templates.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify([{name:'Импорт',docType:'notes',profile:{structure:[null,{}, {title:'Безопасный раздел'}],formatRules:[null,{}]}}]))});
  await page.waitForFunction(()=>document.querySelectorAll('#tplList article').length===3);assert.equal(errors.length,0);
 });
 await check('Desktop and mobile overflow, all views',async()=>{
   for(let width of [1440,390,320]){await page.setViewportSize({width,height:900});for(let id of ['new','lib','res','api']){await page.click('#t-'+id);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'overflow '+width+' '+id)}}
 });
 await check('Dark theme, language, settings persist on reload',async()=>{
  await page.click('#themeBtn');let theme=await page.getAttribute('html','data-theme');await page.click('[data-lang=kk]');await page.reload();assert.equal(await page.getAttribute('html','lang'),'kk');assert.equal(await page.getAttribute('html','data-theme'),theme);await page.click('#t-api');assert.equal(await page.inputValue('#orModel'),'provider/model');
 });
 await check('Clear key removes session and permanent copies',async()=>{
  await page.check('#rememberKey');await page.click('#orSave');assert(await page.evaluate(()=>!!localStorage.getItem('or_key')));await page.click('#orClear');assert.equal(await page.evaluate(()=>localStorage.getItem('or_key')),null);assert.equal(await page.evaluate(()=>sessionStorage.getItem('su_api_key')),null);
 });
 assert.deepEqual(errors,[]);
 fs.writeFileSync(path.join(root,'tests','last-run.json'),JSON.stringify({passed,unhandledErrors:errors,mockedAPI:true},null,2));
 await context.close();await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
