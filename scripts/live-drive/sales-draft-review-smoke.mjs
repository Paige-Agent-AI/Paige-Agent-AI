import {chromium} from 'playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
import {strict as assert} from 'node:assert';
const out='docs/evidence/ui-delivery/sales-governed-draft';mkdirSync(out,{recursive:true});
const browser=await chromium.launch({headless:true});const results=[];
try{for(const [width,height] of [[1536,770],[1366,768],[1024,768],[900,1000],[390,844]])for(const theme of ['dark','light'])for(const open of [true,false]){
 const page=await browser.newPage({viewport:{width,height}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:5301/');await page.getByLabel('Theme',{exact:true}).selectOption(theme);if(!open)await page.getByRole('button',{name:'PAIGE open',exact:true}).click();await page.getByLabel('State',{exact:true}).selectOption('review');
 const geom=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,bodyScroll:document.body.scrollWidth}));assert(geom.scroll<=width+1&&geom.bodyScroll<=width+1,`horizontal overflow ${width}`);assert.deepEqual(errors,[]);
 if(open){await page.getByRole('button',{name:'Approve',exact:true}).scrollIntoViewIfNeeded();await page.getByRole('button',{name:'Approve',exact:true}).click();await page.getByRole('button',{name:'Simulate canonical readback'}).click();await page.getByText('Canonical draft saved and read back. It has not been issued, sent or paid.',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Approve',exact:true}).count(),0);await page.getByLabel('State',{exact:true}).selectOption('review');await page.getByRole('button',{name:'Not now',exact:true}).click();await page.getByText('No command was dispatched. The conversation can continue.',{exact:true}).waitFor();for(const state of ['missing date','refused','expired','offline','unknown','workspace changed']){await page.getByLabel('State',{exact:true}).selectOption(state);if(state!=='missing date')assert.equal(await page.getByRole('button',{name:'Approve',exact:true}).count(),0)}await page.getByLabel('State',{exact:true}).selectOption('review');await page.keyboard.press('Tab');await page.emulateMedia({reducedMotion:'reduce'});}
 results.push({width,height,theme,open,geometry:geom,errors,proof:'LOCAL component fixture, not authenticated Chat'});
 if(open&&theme==='dark'&&[1366,390].includes(width))await page.screenshot({path:`${out}/${width}-review.png`,fullPage:true});await page.close();
}
for(const [width,height,theme,state] of [[390,844,'dark','saved'],[390,844,'dark','unknown'],[390,844,'dark','refused'],[1366,768,'light','review']]){
 const page=await browser.newPage({viewport:{width,height},reducedMotion:'reduce'});await page.goto('http://127.0.0.1:5301/');await page.getByLabel('Theme',{exact:true}).selectOption(theme);await page.getByLabel('State',{exact:true}).selectOption(state);await page.screenshot({path:`${out}/${width}-${theme}-${state}.png`,fullPage:true});await page.close();
}
writeFileSync(`${out}/geometry.json`,JSON.stringify(results,null,2));console.log(`PASS ${results.length} actual-component fixture viewport/theme/open cases; hosted Chat UNVERIFIED`);}finally{await browser.close()}
