import assert from 'node:assert/strict';

// Additional paths in the existing source-mount drive; NEVER native save,
// authenticated-role or provider evidence. The PDF is generated/inspected by the
// original native engine, and the actual browser renders its bytes/worker/fonts.
export async function exerciseAgreementDocumentFields({page,url,capture,frames,behavior,setFixtureMode}){
 const save=()=>page.getByRole('button',{name:/^Save (draft fields|document preparation)$/});
 const ready=async n=>{await page.locator(`.e04-pdf-paper[data-rendered-page="${n}"]`).waitFor();};
 const enter=async(theme='light',paige='closed')=>{await page.goto(url(theme,paige)+'&fieldsProof=1',{waitUntil:'domcontentloaded'});await ready(1);};
 const pixels=()=>page.locator('.e04-pdf-paper canvas').evaluate(canvas=>{const pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;let ink=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i]<110&&pixels[i+1]<110&&pixels[i+2]<110&&pixels[i+3]>200)ink++;return ink;});
 for(const theme of ['light','dark'])for(const [width,height]of [[1536,770],[1366,768],[1024,768],[900,1000],[390,844],[320,740]])for(const paige of width>=900?['closed','open']:['closed']){
  await page.setViewportSize({width,height});await enter(theme,paige);
  const overlay=width<=1080&&paige==='open';
  if(overlay)await page.getByRole('button',{name:'Fold PAIGE conversation',exact:true}).last().click();
  if(width<600){await page.getByRole('combobox',{name:'Document zoom',exact:true}).selectOption('1');await page.locator('.e04-pdf-paper[data-rendered-page="1"][data-rendered-zoom="1"]').waitFor();}
  assert.ok(await pixels()>100,'Native PDF canvas must contain actual rendered text, not a blank success state');
  await page.getByRole('button',{name:'Add at page centre',exact:true}).click();
  await page.getByRole('spinbutton',{name:'Top position in points',exact:true}).fill('120');
  await save().click();
  await page.getByText('Local proposal captured. No native save was executed.',{exact:true}).waitFor();
  const draft=JSON.parse(await page.locator('[data-proof-proposal]').textContent());
  assert.equal(draft.ready_for_review,false);assert.equal(draft.manifest.fields.length,1);assert.equal(draft.manifest.fields[0].page,1);assert.equal(draft.manifest.fields[0].y,120);
  const fit=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth,paper:document.querySelector('.e04-pdf-well').getBoundingClientRect().toJSON()}));
  assert.ok(fit.document<=width+1,JSON.stringify(fit));assert.ok(fit.paper.width>0&&fit.paper.right<=width+1&&fit.paper.left>=0,JSON.stringify(fit));
  await page.locator('.e04-document-fields-head').scrollIntoViewIfNeeded();await capture(`${width}-${height}-${theme}-${paige}`);frames.push({theme,width,height,requestedPaige:paige,actualPaige:overlay?'folded-before-fields':paige,fit});
 }
 behavior.push('actual browser PDF canvas/worker/font rendering, not iframe or fabricated document','native crop/rotation geometry and viewport fit','unfinished fields delegate one exact immutable native-validator proposal, no save claim','all source viewport/theme/actual native Fold states');
 await page.setViewportSize({width:1366,height:768});await enter();
 await page.getByRole('button',{name:'Add at page centre',exact:true}).click();
 await page.getByRole('spinbutton',{name:'Top position in points',exact:true}).fill('80');
 const field=page.getByRole('button',{name:/^Signature, Controlled Client, page 1/});
 await field.focus();await page.keyboard.press('ArrowRight');await page.keyboard.press('Shift+ArrowDown');
 assert.equal(await page.getByRole('spinbutton',{name:'Left position in points',exact:true}).inputValue(),'237');
 assert.equal(await page.getByRole('spinbutton',{name:'Top position in points',exact:true}).inputValue(),'90');
 await page.getByRole('button',{name:'Undo field change',exact:true}).click();
 await page.getByRole('button',{name:/^Signature.*Controlled Client.*Page 1/}).click();
 assert.equal(await page.getByRole('spinbutton',{name:'Top position in points',exact:true}).inputValue(),'80');
 for(const [kind,top]of [['Initials',160],['Signed date',230],['Text',300],['Checkbox',370]]){
  await page.getByRole('button',{name:kind,exact:true}).click();await page.getByRole('button',{name:'Add at page centre',exact:true}).click();await page.getByRole('spinbutton',{name:'Top position in points',exact:true}).fill(String(top));
 }
 await page.getByRole('button',{name:'Next document page',exact:true}).click();
 const early=await page.evaluate(()=>({enabled:!document.querySelector('.e04-document-review .e04-preparation-primary').disabled,painted:document.querySelector('.e04-pdf-paper')?.getAttribute('data-rendered-page')}));
 assert.ok(!early.enabled||early.painted==='2','New-page controls must never act on previous-page pixels');
 await ready(2);assert.ok(await pixels()>100);
 assert.equal(await page.getByRole('group',{name:'Selected field',exact:true}).count(),0,'A previous-page field must not be edited against the new page geometry');
 await page.getByRole('combobox',{name:'Field recipient',exact:true}).selectOption('d2222222-0000-4000-8000-000000000002');
 await page.getByRole('button',{name:'Signature',exact:true}).click();await page.getByRole('button',{name:'Add at page centre',exact:true}).click();await page.getByRole('spinbutton',{name:'Top position in points',exact:true}).fill('80');
 await page.getByRole('button',{name:'Save document preparation',exact:true}).click();
 let proposal=JSON.parse(await page.locator('[data-proof-proposal]').textContent());
 assert.equal(proposal.ready_for_review,true);assert.equal(proposal.manifest.fields.length,6);assert.equal(proposal.manifest.fields.filter(field=>field.page===2).length,1);assert.equal(new Set(proposal.manifest.fields.map(field=>field.kind)).size,5);
 await page.locator('.e04-document-page-controls').scrollIntoViewIfNeeded();await capture('actual-rotated-page-assigned-fields');
 await page.getByRole('button',{name:'Checkbox',exact:true}).click();await page.getByRole('button',{name:'Place on document',exact:true}).click();
 const paper=page.locator('.e04-pdf-paper[data-rendered-page="2"]');const box=await paper.boundingBox();
 await paper.click({position:{x:40/600*box.width,y:200/400*box.height}});
 assert.ok(Math.abs(Number(await page.getByRole('spinbutton',{name:'Left position in points',exact:true}).inputValue())-30)<1);
 assert.ok(Math.abs(Number(await page.getByRole('spinbutton',{name:'Top position in points',exact:true}).inputValue())-190)<1);
 assert.equal(JSON.parse(await page.locator('[data-proof-proposal]').textContent()).manifest.fields.length,6,'An earlier captured proposal must not silently acquire later draft fields');
 const checkbox=page.getByRole('button',{name:/^Checkbox, Controlled Business Signer, page 2/});await checkbox.focus();await page.keyboard.press('Delete');await page.getByRole('button',{name:'Undo field change',exact:true}).click();
 await page.getByRole('button',{name:'Save document preparation',exact:true}).click();proposal=JSON.parse(await page.locator('[data-proof-proposal]').textContent());assert.equal(proposal.manifest.fields.length,7);assert.equal(proposal.ready_for_review,true);
 await page.getByRole('button',{name:'Place on document',exact:true}).click();await page.keyboard.press('Escape');assert.equal(await page.getByRole('button',{name:'Place on document',exact:true}).getAttribute('aria-pressed'),'false');
 await page.evaluate(()=>window.dispatchEvent(new CustomEvent('e04-document-fixture',{detail:{canEdit:false}})));
 assert.equal(await page.getByRole('button',{name:'Add at page centre',exact:true}).isDisabled(),true);assert.equal(await save().isDisabled(),true);
 await page.evaluate(()=>window.dispatchEvent(new CustomEvent('e04-document-fixture',{detail:{canView:false}})));
 await page.getByText('Document preparation is hidden while business access is checked.',{exact:true}).waitFor();assert.equal(await page.locator('.e04-pdf-paper').count(),0);assert.equal(await page.locator('[data-proof-proposal]').textContent(),'');
 behavior.push('actual keyboard native-point movement and undo','all five field kinds/two original signer identities/two actual pages','90-degree crop renders before any new-page placement','read-only controls, scope mask and private fixture erasure','physical pointer placement on rotated native page, Delete/Undo/Escape and earlier-proposal immutability');
 setFixtureMode('corrupt');await enterError();assert.equal(await save().isDisabled(),true);await capture('changed-pdf-bytes-refused');
 setFixtureMode('geometry');await enterError();assert.equal(await save().isDisabled(),true);await capture('inconsistent-page-geometry-refused');
 behavior.push('real byte corruption rejected before editable preview','real native/browser page mismatch refuses readiness');
 setFixtureMode('normal');await enter();await ready(1);
 async function enterError(){await page.goto(url()+'&fieldsProof=1',{waitUntil:'domcontentloaded'});await page.getByRole('heading',{name:'Document preview unavailable',exact:true}).waitFor();assert.equal(await page.locator('.e04-pdf-paper[data-rendered-page]').count(),0);}
}
