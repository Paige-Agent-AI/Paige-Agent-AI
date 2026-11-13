// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
declare const Deno: { resolveDns: (host: string, type: string) => Promise<string[]> };
import { readResolvedPublicationAsset, type ResolvedPublicationAsset } from '../../supabase/functions/_shared/social-publish-command/media.ts';

const TENANT = '10000000-0000-4000-8000-000000000001';
const ORIGIN = 'https://test-project.supabase.co';
const bytes = new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82]);
const asset: ResolvedPublicationAsset = {
  contentId: '20000000-0000-4000-8000-000000000001', contentRevision: '2026-11-11T12:00:00.000Z',
  type: 'image', storagePath: `${TENANT}/original.png`,
  sourceUrl: `${ORIGIN}/storage/v1/object/public/paige-generated/${TENANT}/original.png`,
  contentType: 'image/png', size: bytes.length, etag: '"original-object"',
  lastModified: '2026-11-11T12:00:00.000Z', altText: null,
};
const headers = () => ({'Content-Type':'image/png','Content-Length':String(bytes.length),ETag:'"original-object"','Last-Modified':'Wed, 11 Nov 2026 12:00:00 GMT'});
const read = (over: Partial<ResolvedPublicationAsset> = {}, origin = ORIGIN, tenantId = TENANT) =>
  readResolvedPublicationAsset({tenantId, storageOrigin:origin, asset:{...asset,...over}});
beforeEach(() => {
  vi.stubGlobal('Deno',{resolveDns:vi.fn().mockResolvedValue(['8.8.8.8'])});
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(bytes,{headers:headers()})));
});
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});

describe('effect-time original media bytes before transfer to the Social adapter',()=>{
  it('reads the exact approved object conditionally without forwarding credentials',async()=>{
    expect(await read()).toEqual(bytes);
    expect(fetch).toHaveBeenCalledOnce();
    const [url,init]=vi.mocked(fetch).mock.calls[0];
    expect(url).toBe(asset.sourceUrl);
    expect(init).toMatchObject({method:'GET',redirect:'manual',headers:{'If-Match':'"original-object"'}});
    expect(new Headers(init?.headers).has('Authorization')).toBe(false);
  });
  it.each([
    {sourceUrl:'https://foreign.example/file.png'},
    {sourceUrl:asset.sourceUrl+'?token=secret'},
    {storagePath:'../foreign.png'},
    {etag:'W/"weak-object"'},
    {size:26*1024*1024},
    {size:0},
  ])('refuses invalid source facts before network %j',async over=>{
    expect(await read(over)).toBeNull();expect(fetch).not.toHaveBeenCalled();
  });
  it('does not use the approved source in another workspace or configured origin',async()=>{
    expect(await read({},ORIGIN,'10000000-0000-4000-8000-000000000002')).toBeNull();
    expect(await read({},'https://other-project.supabase.co')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([302,404,412,500])('refuses status %i without following a new location',async status=>{
    vi.mocked(fetch).mockResolvedValue(new Response(null,{status,headers:{Location:'https://foreign.example'}}));
    expect(await read()).toBeNull();expect(fetch).toHaveBeenCalledOnce();
  });
  it.each([
    {ETag:'"different-object"'}, {'Content-Type':'text/html'},
    {'Content-Length':'999'}, {'Last-Modified':'Wed, 11 Nov 2026 12:00:01 GMT'},
  ])('refuses changed served identity %j',async over=>{
    vi.mocked(fetch).mockResolvedValue(new Response(bytes,{headers:{...headers(),...over}}));
    expect(await read()).toBeNull();
  });
  it('stops on an oversized stream and cancels its reader',async()=>{
    const cancel=vi.fn();
    const stream=new ReadableStream({start(c){c.enqueue(new Uint8Array(bytes.length+1));},cancel});
    vi.mocked(fetch).mockResolvedValue(new Response(stream,{headers:headers()}));
    expect(await read()).toBeNull();expect(cancel).toHaveBeenCalledOnce();
  });
  it('does not await a cancellation hook that never settles',async()=>{
    vi.useFakeTimers();
    const cancel=vi.fn(()=>new Promise<void>(()=>{}));
    const stream=new ReadableStream({start(c){c.enqueue(new Uint8Array(bytes.length+1));},cancel});
    vi.mocked(fetch).mockResolvedValue(new Response(stream,{headers:headers()}));
    let settled=false;
    const pending=read().then(result=>{settled=true;return result;});
    await vi.advanceTimersByTimeAsync(15_001);
    expect(settled).toBe(true);expect(await pending).toBeNull();expect(cancel).toHaveBeenCalledOnce();
  });
  it('refuses a partial stream and an image MIME with unrelated bytes',async()=>{
    vi.mocked(fetch).mockResolvedValueOnce(new Response(bytes.slice(0,8),{headers:headers()}));
    expect(await read()).toBeNull();
    vi.mocked(fetch).mockResolvedValueOnce(new Response(new Uint8Array(bytes.length),{headers:headers()}));
    expect(await read()).toBeNull();
  });
  it('refuses private DNS and failed transport without exposing internal errors',async()=>{
    vi.mocked(Deno.resolveDns).mockResolvedValue(['127.0.0.1']);
    expect(await read()).toBeNull();expect(fetch).not.toHaveBeenCalled();
    vi.mocked(Deno.resolveDns).mockResolvedValue(['8.8.8.8']);
    vi.mocked(fetch).mockRejectedValue(Error('private credential details'));
    expect(await read()).toBeNull();
  });
  it('bounds DNS, including a resolver that never returns',async()=>{
    vi.useFakeTimers();vi.mocked(Deno.resolveDns).mockImplementation(()=>new Promise(()=>{}));
    const pending=read();await vi.advanceTimersByTimeAsync(15_001);
    expect(await pending).toBeNull();expect(fetch).not.toHaveBeenCalled();
  });
});
