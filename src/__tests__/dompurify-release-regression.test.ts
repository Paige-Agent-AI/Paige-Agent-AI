import {describe,expect,it} from 'vitest';
import createDOMPurify from 'dompurify';
import {renderSignaturePreview} from '../components/admin/comms/mergeVars';

describe('existing HTML sanitizer dependency',()=>{
 it('scrubs split benign template expressions from an attached shadow root',()=>{
  const purify=createDOMPurify(window);
  const host=document.createElement('div'),root=host.attachShadow({mode:'open'});
  root.append(document.createTextNode('$'),document.createElement('object'),document.createTextNode('{benignToken}'));
  purify.sanitize(host,{IN_PLACE:true,SAFE_FOR_TEMPLATES:true});
  root.normalize();
  expect(root.querySelector('object')).toBeNull();
  expect(root.textContent).not.toContain('${benignToken}');
 });

 it('preserves actual signature-preview formatting while removing active markup',()=>{
  const html=renderSignaturePreview('<p><strong>{{name}}</strong><img src="/favicon.png" onerror="void(0)"><script>void(0)</script><a href="javascript:void(0)">Read</a><span>{{missing}}</span></p>',{'{{name}}':'<em>Sample &amp; Co</em>'});
  const preview=document.createElement('div');preview.innerHTML=html;
  expect(preview.querySelector('strong em')?.textContent).toBe('Sample & Co');
  expect(preview.querySelector('script')).toBeNull();
  expect(preview.querySelector('img')?.hasAttribute('onerror')).toBe(false);
  expect(preview.querySelector('a')?.hasAttribute('href')).toBe(false);
  expect(preview.textContent).not.toContain('{{missing}}');
 });
});
