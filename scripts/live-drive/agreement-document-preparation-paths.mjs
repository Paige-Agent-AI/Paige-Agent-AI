import assert from 'node:assert/strict';

// Extend the existing actual Sales source drive, not an alternate customer UI.
// Auth/API/RPC are explicitly synthetic. These paths NEVER prove hosted records,
// real authorization, signature/provider behavior or customer acceptance.
export async function exerciseDocumentPreparationPaths({page,url,capture,frames,behavior,ports,agreementId}){
 const diagnostic=process.argv.includes('--diagnose-narrow');
 const ready=()=>page.locator('.e04-pdf-paper[data-rendered-page="1"]').waitFor();
 const save=()=>page.getByRole('button',{name:/^Save (draft fields|document preparation)$/});
 const postCount=()=>ports.requests.filter(r=>r.method==='POST').length;
 const target=(theme='light',paige='closed')=>url(theme,paige)+`&preparationsProof=1&agreement=${agreementId}`;
 const enter=async(theme='light',paige='closed',fold=false)=>{
   await page.goto(target(theme,paige),{waitUntil:'domcontentloaded'});
   await page.getByRole('heading',{name:'Controlled uploaded service document',exact:true}).first().waitFor();
   if(fold)await page.getByRole('button',{name:'Fold PAIGE conversation',exact:true}).last().click();
   await page.getByRole('button',{name:'Prepare document and fields',exact:true}).click();
   if(!ports.selected()){await page.getByRole('button',{name:'Prepare exact PDF',exact:true}).click();}
   await ready();
 };
 let index=0;
 for(const theme of diagnostic?['light']:['light','dark'])for(const [width,height]of diagnostic?[[390,844]]:[[1536,770],[1366,768],[1024,768],[900,1000],[390,844],[320,740]])for(const paige of width>=900?['closed','open']:['closed']){
   const trace=[];const navTrace=async step=>{if(width<600)trace.push(await page.evaluate(step=>{const nav=document.querySelector('.sales-tabs'),active=nav?.querySelector('[aria-selected=true]');return {step,scrollLeft:nav?.scrollLeft,selected:active?.getBoundingClientRect().toJSON(),focus:document.activeElement?.getAttribute('aria-label')??document.activeElement?.textContent?.slice(0,80)};},step));};
   await page.setViewportSize({width,height});const folded=width<=1080&&paige==='open';await enter(theme,paige,folded);
   await navTrace('entry');
   if(width<600){await page.getByRole('combobox',{name:'Document zoom',exact:true}).selectOption('1');await page.locator('.e04-pdf-paper[data-rendered-page="1"][data-rendered-zoom="1"]').waitFor();}
   const before=postCount(),count=ports.preparations.size;
   await page.getByRole('button',{name:'Add at page centre',exact:true}).click();
   if(width===390&&theme==='light'){
     const beforeUrl=page.url();await page.getByRole('tab',{name:'Terms & Agreements',exact:true}).focus();await navTrace('before-key');await page.keyboard.press('ArrowRight');assert.equal(await page.getByRole('alertdialog').count(),1);await navTrace('dialog-open');await page.getByRole('button',{name:'Continue editing',exact:true}).click();await navTrace('dialog-canceled');assert.equal(page.url(),beforeUrl);
   }
   const top=100+(index%10)*40;await page.getByRole('spinbutton',{name:'Top position in points',exact:true}).fill(String(top));
   await save().click();await page.getByText('Document preparation recorded. Nothing has been sent for signature.',{exact:true}).waitFor();await ready();
   assert.equal(await page.locator('.e04-native-preparation-heading h3').evaluate(element=>element===document.activeElement),true,'Verified save must leave keyboard focus on its original document result');
   await navTrace('saved');
   assert.equal(postCount(),before+1);assert.equal(ports.preparations.size,count+1);
   const retained=ports.preparations.get(ports.selected());assert.ok(retained.manifest.fields.some(field=>field.y===top));
   assert.equal(new URL(page.url()).searchParams.get('agreement_document_request'),retained.id);assert.equal(new URL(page.url()).searchParams.get('agreement_business'),'aaaaaaaa-0000-4000-8000-000000000001');
   assert.equal(await page.getByRole('button',{name:'Fields saved',exact:true}).isDisabled(),true);
   if(width<600){await page.getByRole('combobox',{name:'Document zoom',exact:true}).selectOption('1');await page.locator('.e04-pdf-paper[data-rendered-page="1"][data-rendered-zoom="1"]').waitFor();}
   const pixels=await page.locator('.e04-pdf-paper canvas').evaluate(canvas=>{const data=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;let ink=0;for(let i=0;i<data.length;i+=4)if(data[i]<100&&data[i+1]<100&&data[i+2]<100&&data[i+3]>200)ink++;return ink;});assert.ok(pixels>100,`Exact actual PDF canvas must contain document text; observed ${pixels} ink pixels`);
   await page.locator('.e04-native-preparation-heading').scrollIntoViewIfNeeded();
   const fit=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth,pageScroll:scrollY,workspace:document.querySelector('.e04-native-preparation').getBoundingClientRect().toJSON(),navigation:document.querySelector('.sales-tabs').getBoundingClientRect().toJSON(),selectedTab:document.querySelector('.sales-tabs [aria-selected=true]').getBoundingClientRect().toJSON()}));assert.ok(fit.document<=width+1,JSON.stringify(fit));assert.equal(fit.pageScroll,0);
   if(width<600){assert.ok(fit.navigation.height<=64,JSON.stringify({fit,trace}));assert.ok(fit.selectedTab.left>=fit.navigation.left&&fit.selectedTab.right<=fit.navigation.right,JSON.stringify({fit,trace}));assert.equal(await page.getByRole('tablist',{name:'Sales departments'}).getByRole('tab').count(),6);}
   await capture(`${width}-${height}-${theme}-${paige}`);frames.push({theme,width,height,requestedPaige:paige,actualPaige:folded?'folded-before-document':paige,fit,pixels});index++;
   if(width===1366&&paige==='closed'||width===320&&theme==='dark'){
     await page.locator('.e04-pdf-paper').scrollIntoViewIfNeeded();await capture(`${width}-${height}-${theme}-${paige}-document`);
   }
 }
 if(diagnostic){behavior.push('DIAGNOSTIC ONLY: one narrow current-tab/guard/field-save trace; not full matrix evidence');return;}
 behavior.push('actual Sales entry and same original agreement context','twenty viewport/theme/PAIGE states with genuine field controls and exact SDK request receipts','actual neutral PDF bytes/font/worker canvas, native-point field placement and immutable document versions','save action reachable at320/390 and no application overflow','unchanged saved field map cannot create a duplicate version');
 await page.setViewportSize({width:1366,height:850});await enter();
 const selected=ports.selected(),beforeReload=postCount();await page.reload();await ready();assert.equal(ports.selected(),selected);assert.equal(new URL(page.url()).searchParams.get('agreement_document_request'),selected);assert.equal(postCount(),beforeReload);
 await page.getByRole('button',{name:'Inspect preparation history',exact:true}).click();await page.getByRole('combobox',{name:'Retained document version',exact:true}).waitFor();
 const earlier=[...ports.preparations.keys()].at(-2);await page.getByRole('combobox',{name:'Retained document version',exact:true}).selectOption(earlier);await ready();assert.equal(ports.selected(),selected);assert.equal(await page.getByRole('button',{name:'Add at page centre',exact:true}).isDisabled(),true);await capture('earlier-preparation-is-readonly');
 await page.getByRole('button',{name:'Read earlier preparations',exact:true}).click();await page.getByRole('combobox',{name:'Retained document version',exact:true}).getByRole('option',{name:/Preparation 1 ·/}).waitFor({state:'attached'});assert.equal(await page.getByRole('combobox',{name:'Retained document version',exact:true}).getByRole('option').count(),2);await page.getByRole('button',{name:'Read latest history',exact:true}).click();await page.getByRole('combobox',{name:'Retained document version',exact:true}).getByRole('option',{name:/Preparation 21 ·/}).waitFor({state:'attached'});
 await page.getByRole('button',{name:'Read selected preparation',exact:true}).click();await ready();assert.equal(await page.getByRole('button',{name:'Add at page centre',exact:true}).isEnabled(),true);
 behavior.push('reload recovers the identical opaque preparation with zero new write','native paged history inspects an earlier map without reselecting or editing it');
 await page.getByRole('button',{name:'Add at page centre',exact:true}).click();const fields=ports.preparations.get(selected).manifest.fields.length+1;
 await page.getByRole('button',{name:'Return to agreement',exact:true}).click();assert.equal(await page.getByRole('alertdialog').count(),1);await page.getByRole('button',{name:'Continue editing',exact:true}).click();assert.match(await page.locator('.e04-document-field-count').textContent(),new RegExp('^'+fields+' fields$'));
 await page.evaluate(()=>window.dispatchEvent(new CustomEvent('e04-authoring-port',{detail:{authorityUnknown:true}})));await page.getByRole('heading',{name:'Agreement access is being checked',exact:true}).waitFor();assert.equal(await page.locator('.e04-pdf-paper').count(),0);
 await page.evaluate(()=>window.dispatchEvent(new CustomEvent('e04-authoring-port',{detail:{authorityUnknown:false}})));await ready();assert.match(await page.locator('.e04-document-field-count').textContent(),new RegExp('^'+fields+' fields$'));await capture('authority-read-preserves-unsaved-field-proposal');
 behavior.push('single original leave guard/cancel preserves unsaved fields','unknown authority hides PDF and rechecks original source before restoring the same RAM proposal');
 ports.setMode('lost');await save().click();await page.getByRole('heading',{name:'Check the same preparation',exact:true}).waitFor();const lost=ports.selected(),writes=postCount();assert.equal(await page.getByRole('button',{name:'Prepare exact PDF',exact:true}).count(),0);assert.equal(new URL(page.url()).searchParams.get('agreement_document_request'),lost);await capture('lost-response-same-request-recovery');
 ports.setMode('normal');await page.getByRole('button',{name:'Retry same request',exact:true}).click();await page.getByText('The original preparation receipt was recovered. Its current selection is shown separately.',{exact:true}).waitFor();await ready();assert.equal(ports.selected(),lost);assert.equal(postCount(),writes+1);const last=ports.requests.filter(r=>r.method==='POST').slice(-2);assert.equal(last[0].id,last[1].id);assert.equal(last[0].intent,last[1].intent);
 behavior.push('lost acknowledgement retains original identity and locks fresh work','explicit retry resubmits byte-identical intent and recovers one original version/event');
 ports.setMode('corrupt');await page.reload();await page.getByRole('heading',{name:'Retained PDF unavailable',exact:true}).waitFor();assert.equal(await page.locator('.e04-pdf-paper').count(),0);await capture('altered-private-pdf-refused');ports.setMode('normal');await page.getByRole('button',{name:'Retry retained PDF',exact:true}).click();await ready();
 ports.changeSource();await page.reload();await ready();assert.equal(await page.getByRole('button',{name:'Add at page centre',exact:true}).isDisabled(),true);await page.getByText('Recipient labels are unavailable for this version',{exact:true}).waitFor();assert.equal(await page.getByText('Controlled Client',{exact:true}).count(),0);await capture('changed-source-retains-readonly-map');
 behavior.push('actual changed PDF bytes never unlock field editing','source revision change makes retained map read-only and refuses current-name substitution');
 const calls=ports.requests.length;await page.evaluate(()=>window.dispatchEvent(new CustomEvent('e04-authoring-port',{detail:{activeTenantId:'aaaaaaaa-0000-4000-8000-000000000002'}})));await page.getByRole('heading',{name:'Return to the original agreement business',exact:true}).waitFor();assert.equal(await page.locator('.e04-pdf-paper').count(),0);assert.equal(ports.requests.length,calls);
 behavior.push('original business checkpoint refuses a different business with no document request');
}
