import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {it,expect,vi} from 'vitest';
import PaymentReturn from './PaymentReturn';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
it('never treats a forged success redirect as payment evidence or performs network activity',()=>{
 const fetchMock=vi.fn();vi.stubGlobal('fetch',fetchMock);const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 history.replaceState(null,'','/payment-return?status=paid&amount=3500&session_id=cs_foreign');
 try{act(()=>root.render(<PaymentReturn/>));expect(location.search).toBe('');expect(host.textContent).toContain('Check your invoice for the latest balance');expect(host.textContent).not.toContain('Payment received');expect(host.textContent).not.toContain('cs_foreign');expect(host.querySelector('form')).toBeNull();expect(fetchMock).not.toHaveBeenCalled();}finally{act(()=>root.unmount());host.remove();vi.unstubAllGlobals();}
});
