import assert from 'node:assert/strict';

// Actual original panel/shared modal and owning shell. Only the request result
// is controlled; no real send, provider, approval or durable acceptance proof.
export async function exerciseSignatureRequestPaths({page,url,capture,frames,behavior}){
  const go=async(mode,theme='light',paige='closed')=>{
    await page.goto(url(theme,paige)+`&signatureProof=1&signatureOutcome=${mode}`,{waitUntil:'domcontentloaded'});
    await page.getByRole('button',{name:'Review signature request',exact:true}).click();
    await page.getByRole('dialog',{name:'Send for signature',exact:true}).waitFor();
    assert.match(await page.getByRole('status').last().innerText(),/Reviewing this panel/);
  };
  const send=()=>page.getByRole('button',{name:'Send it to Alexandra',exact:true}).click();
  for(const theme of ['light','dark'])for(const [width,height]of [[1536,770],[1366,768],[1024,768],[900,1000],[390,844],[320,740]])for(const paige of width>=900?['closed','open']:['closed']){
    await page.setViewportSize({width,height});
    const overlay=width<=1080&&paige==='open';
    // Native conversation overlay is folded before protected modal entry.
    if(overlay){
      await page.goto(url(theme,paige)+'&signatureProof=1&signatureOutcome=partial',{waitUntil:'domcontentloaded'});
      await page.getByRole('button',{name:'Fold PAIGE conversation',exact:true}).last().click();
      await page.getByRole('button',{name:'Review signature request',exact:true}).click();
    }else await go('partial',theme,paige);
    await send();
    const result=page.getByRole('heading',{name:'Accepted for sending',exact:true});await result.waitFor();
    assert.equal(await result.evaluate(el=>el===document.activeElement),true,'original result receives keyboard focus');
    const dialog=page.getByRole('dialog',{name:'Send for signature',exact:true});
    const content=await dialog.innerText();assert.match(content,/Delivery, document opening/);assert.match(content,/secondary.recipient/);assert.match(content,/earlier.recipient/);assert.match(content,/status could not be updated/);assert.doesNotMatch(content,/did not receive it|has a private link|record now shows/);
    const fit=await dialog.evaluate(el=>({viewport:innerWidth,document:document.documentElement.scrollWidth,width:el.clientWidth,scrollWidth:el.scrollWidth,bodyWidth:el.querySelector('.so-editor-body').clientWidth,bodyScrollWidth:el.querySelector('.so-editor-body').scrollWidth,recapHeight:el.querySelector('.so-recap').clientHeight,recapContentHeight:el.querySelector('.so-recap').scrollHeight,pageScroll:scrollY,background:getComputedStyle(el).backgroundColor,backgroundImage:getComputedStyle(el).backgroundImage,controls:[...el.querySelectorAll('button')].map(button=>button.getBoundingClientRect().height)}));
    assert.ok(fit.document<=width+1&&fit.scrollWidth<=fit.width+1&&fit.bodyScrollWidth<=fit.bodyWidth+1,JSON.stringify(fit));assert.equal(fit.pageScroll,0);
    assert.ok(fit.backgroundImage!=='none'||fit.background!=='rgba(0, 0, 0, 0)','Signing panel must obscure its original inert background');assert.ok(fit.controls.every(height=>height>=44),'Signing controls retain touch targets');
    assert.ok(fit.recapContentHeight<=fit.recapHeight+1,'Original document/client recap must scroll intact instead of shrinking and clipping its facts');
    await page.evaluate(()=>document.fonts.ready);await capture(`${width}-${height}-${theme}-${paige}-partial`);frames.push({theme,width,height,paige,actualPaige:overlay?'folded-before-modal':paige,fit});
    const done=dialog.getByRole('button',{name:'Done',exact:true}).last();await done.scrollIntoViewIfNeeded();await done.focus();await page.keyboard.press('Tab');assert.equal(await dialog.getByRole('button',{name:'Done',exact:true}).first().evaluate(el=>el===document.activeElement),true,'native modal retains Tab');
    await page.keyboard.press('Escape');assert.equal(await page.getByRole('button',{name:'Review signature request',exact:true}).evaluate(el=>el===document.activeElement),true,'Escape returns original trigger focus');
  }
  for(const mode of ['accepted','unknown','refused','pending']){
    await page.setViewportSize({width:320,height:740});await go(mode,'dark');await send();
    const dialog=page.getByRole('dialog',{name:'Send for signature',exact:true});
    if(mode==='accepted')await page.getByRole('heading',{name:'Accepted for sending',exact:true}).waitFor();
    if(mode==='unknown'){
      const result=page.getByRole('heading',{name:'Signing request not verified',exact:true});await result.waitFor();assert.equal(await result.evaluate(el=>el===document.activeElement),true);
      assert.equal(await dialog.getByRole('button',{name:/Send it to|Make.*link|Stop the current link|Or copy/}).count(),0);
      await capture('unknown-return-to-original-record');await dialog.getByRole('button',{name:'Return to agreement',exact:true}).click();
      assert.equal(await page.getByRole('button',{name:'Review signature request',exact:true}).evaluate(el=>el===document.activeElement),true);assert.equal(await page.getByRole('status').innerText(),'Controlled request count: 1');
    }else if(mode==='refused'){
      await page.getByRole('alert').waitFor();assert.equal(await dialog.getByRole('button',{name:'Send it to Alexandra',exact:true}).isEnabled(),true);await capture('correctable-source-refusal');
    }else if(mode==='pending'){
      assert.equal(await dialog.getByRole('button',{name:'Sending…',exact:true}).isDisabled(),true);await capture('pending-request-safe-exit');await dialog.getByRole('button',{name:'Back',exact:true}).click();assert.equal(await page.getByRole('dialog').count(),0);
    }else await capture('accepted-distinct-from-delivered');
  }
  behavior.push('actual original panel and native shell in both themes/required desktop/narrow viewports','provider acceptance separate from delivery/view/signature','partial issues/warnings retain actual recipient details','long recipient/status content wraps','native result focus/Tab/Escape/trigger return','unknown offers original-record inspection without immediate repeat/link/void','source refusal correctable','pending original request remains escapable without cancellation claim');
}
