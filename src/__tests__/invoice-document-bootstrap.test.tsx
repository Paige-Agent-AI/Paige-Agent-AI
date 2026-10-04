import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const telemetry=vi.hoisted(()=>({sentry:vi.fn(),posthog:vi.fn(),render:vi.fn()}));
vi.mock('@sentry/react',()=>({init:telemetry.sentry}));
vi.mock('posthog-js',()=>({default:{init:telemetry.posthog}}));
vi.mock('react-dom/client',()=>({createRoot:()=>({render:telemetry.render})}));
vi.mock('../App.tsx',()=>({default:()=>null}));
vi.mock('react-helmet-async',()=>({HelmetProvider:()=>null}));
describe('actual public invoice bootstrap privacy',()=>{
 beforeEach(()=>{vi.resetModules();vi.clearAllMocks();vi.stubEnv('VITE_SENTRY_DSN','https://example.test/1');vi.stubEnv('VITE_POSTHOG_KEY','configured-fixture-key');vi.stubGlobal('requestAnimationFrame',vi.fn());document.body.innerHTML='<div id="root"></div>';});
 afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();window.history.replaceState(null,'','/');});
 it.each(['/invoice','/invoice/','/INVOICE'])('never initializes telemetry before rendering bearer route %s',async path=>{window.history.replaceState(null,'',path+'?token='+'a'.repeat(64));await import('../main.tsx');expect(telemetry.render).toHaveBeenCalledOnce();expect(telemetry.sentry).not.toHaveBeenCalled();expect(telemetry.posthog).not.toHaveBeenCalled();expect(window.location.search).toContain('token=');});
 it('keeps normal Solo startup telemetry enabled',async()=>{window.history.replaceState(null,'','/solo/fixture/sales/payments');await import('../main.tsx');expect(telemetry.sentry).toHaveBeenCalledOnce();expect(telemetry.posthog).toHaveBeenCalledOnce();expect(telemetry.posthog.mock.invocationCallOrder[0]).toBeLessThan(telemetry.render.mock.invocationCallOrder[0]);});
});
