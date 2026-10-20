const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(path.join(__dirname, '../../../node_modules/playwright'));
const url = process.env.OPERATIONS_PREVIEW_URL || 'http://127.0.0.1:8836';
(async () => {
 const browser = await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 const results = [], errors = [], dir = path.join(__dirname, 'phone-recovery');
 fs.mkdirSync(dir, {recursive:true});
 try {
  for (const theme of ['dark','light']) for (const [width,height] of [[390,844],[1536,770],[1366,768],[1024,768],[900,1000]]) for (const restored of [false,true]) {
   const p = await browser.newPage({viewport:{width,height}});
   p.on('pageerror', e => errors.push(e.message));
   await p.emulateMedia({reducedMotion:'reduce'});
   await p.goto(`${url}/shell.html?role=review&mode=unknown`, {waitUntil:'domcontentloaded'});
   await p.evaluate(t => localStorage.setItem('theme',t),theme); await p.reload();
   await p.getByLabel('Review note',{exact:true}).fill('Original review: clarify the delivery outcome.');
   await p.getByRole('button',{name:'Request changes',exact:true}).click();
   await p.getByRole('button',{name:'Confirm changes request',exact:true}).click();
   await p.waitForFunction(() => !document.querySelector('.fixed.inset-0[data-state]'));
   await p.getByText('The change could not be confirmed. Inspect its recorded state; another write is locked while this outcome remains unconfirmed.',{exact:true}).waitFor();
   if (restored) {
    await p.getByRole('button',{name:'Leave inspection',exact:true}).click();
    await p.getByRole('button',{name:'Refresh fixture work timestamp',exact:true}).click();
    await p.getByRole('button',{name:'Return to inspection',exact:true}).click();
    await p.getByText('An original delivery change remains unconfirmed. Inspect its recorded state before another write.',{exact:true}).waitFor();
   }
   const control = p.getByRole('button',{name:'Inspect recorded state',exact:true});
   if (await control.count() !== 1) throw Error('Recovery action is duplicated');
   const geometry = await control.evaluate(button => {
    const region = button.closest('[role="status"]');
    const r = region?.getBoundingClientRect(), b = button.getBoundingClientRect();
    return {colocated:Boolean(region),region:r?{top:r.top,bottom:r.bottom,left:r.left,right:r.right}:null,button:{top:b.top,bottom:b.bottom,left:b.left,right:b.right},viewport:{width:innerWidth,height:innerHeight},overflow:document.documentElement.scrollWidth>innerWidth};
   });
   if (!geometry.colocated) throw Error('Recovery action is away from its uncertainty message');
   const r=geometry.region;
   if (r.top<0||r.bottom>height||r.left<0||r.right>width||geometry.overflow) throw Error('Complete recovery region is clipped: '+JSON.stringify(geometry));
   // Enter the scrollable document, then Tab past locked decisions into recovery.
   await p.locator('.ops-staff-document').focus();
   await p.keyboard.press('Tab');
   if (!await control.evaluate(button=>button===document.activeElement)) throw Error('Recovery action is not the next keyboard target');
   const focus = await control.evaluate(button=>({style:getComputedStyle(button).outlineStyle,width:getComputedStyle(button).outlineWidth}));
   if (focus.style==='none'||parseFloat(focus.width)<2) {await p.screenshot({path:path.join(dir,'focus-diagnostic.png')});throw Error('Recovery focus is not visible: '+JSON.stringify(focus));}
   await p.keyboard.press('Enter');
   await p.getByRole('heading',{name:'Workshop delivery, ready for review',exact:true}).waitFor();
   const calls=await p.evaluate(()=>window.__navigationRecoveryFixture.calls());
   const writes=calls.filter(c=>/operations_delivery_(submit|review|release)_scoped/.test(c.name));
   if(writes.length!==1||await p.getByRole('button',{name:'Approve internally',exact:true}).isEnabled()) throw Error('Recovery repeated or unlocked the write');
   if (await p.getByLabel('Review note',{exact:true}).inputValue()!=='Original review: clarify the delivery outcome.') throw Error('Recovery lost the original note');
   if(width===390||width===1536&&!restored) await p.screenshot({path:path.join(dir,`${theme}-${width}-${restored?'restored':'unknown'}.png`)});
   results.push({theme,width,height,restored,geometry,focus,keyboard:true,originalNoteRetained:true,writes:writes.length,noReplay:true});
   await p.close();
  }
 } finally {
  await browser.close();
  fs.writeFileSync(path.join(dir,'verification.json'),JSON.stringify({boundary:'Actual Operations component and canonical helpers with explicit local synthetic caller ports. No customer login, shared shell/PAIGE, provider effect or authenticated acceptance.',results,errors},null,2));
 }
 console.log(JSON.stringify({cases:results.length,errors}));
 if(results.length!==20||errors.length)throw Error('Incomplete phone recovery verification');
})().catch(e=>{console.error(e);process.exitCode=1;});
