// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parseResearchSourcePolicy, researchResultHonorsSourcePolicy, researchSourceUrl } from '../../supabase/functions/_shared/research-source-policy';

describe('shared Research source policy',()=>{
  it('keeps absent constraints optional and normalizes duplicate bare hostnames',()=>{
    expect(parseResearchSourcePolicy({})).toEqual({});
    expect(parseResearchSourcePolicy({max_sources:3,allowed_domains:[' OpenAI.COM ','openai.com']})).toEqual({max_sources:3,allowed_domains:['openai.com']});
  });
  it.each([null,0,-1,1.5,'3',91,Infinity])('rejects a supplied invalid source maximum: %j',max_sources=>{
    expect(()=>parseResearchSourcePolicy({max_sources})).toThrow();
  });
  it.each([null,[],[''],['*.openai.com'],['https://openai.com'],['openai.com/path'],['openai.com:443'],['user@openai.com'],['127.0.0.1'],['openai..com'],['-bad.com'],['bad-.com'],[1],Array(21).fill('openai.com')].map(value=>[value]))('rejects malformed host constraints: %j',allowed_domains=>{
    expect(()=>parseResearchSourcePolicy({allowed_domains})).toThrow();
  });
  it.each(['https://openai.com/a','https://developers.openai.com/a','https://a.b.openai.com/a'])('accepts only full hostname or dot-boundary subdomains: %s',url=>{
    expect(researchSourceUrl(url,{allowed_domains:['openai.com']})).toBe(url);
  });
  it.each(['https://notopenai.com/a','https://openai.com.attacker.invalid/a','https://openai.com@attacker.invalid/a','https://attacker.invalid/openai.com','ftp://openai.com/a','https://user:pass@openai.com/a','not a url'])('refuses lookalikes and unsafe source identity: %s',url=>{
    expect(researchSourceUrl(url,{allowed_domains:['openai.com']})).toBeNull();
  });
  it('normalizes fragments, hostname case/default port and preserves distinct query terms',()=>{
    expect(researchSourceUrl('https://OPENAI.COM:443/a#fragment',{})).toBe('https://openai.com/a');
    expect(researchSourceUrl('https://openai.com/a?q=2',{})).toBe('https://openai.com/a?q=2');
  });
  it('rejects violating native results without slicing or renumbering citations',()=>{
    const policy={max_sources:1,allowed_domains:['openai.com']};
    const sources=[{url:'https://openai.com/a'}];
    const coverage={source_policy:{...policy,admitted_sources:1,limit_reached:true}};
    expect(researchResultHonorsSourcePolicy(policy,sources,coverage)).toBe(true);
    expect(researchResultHonorsSourcePolicy(policy,[...sources,...sources],coverage)).toBe(false);
    expect(researchResultHonorsSourcePolicy(policy,[{url:'https://openai.com.attacker.invalid/a'}],coverage)).toBe(false);
    expect(researchResultHonorsSourcePolicy(policy,sources,{source_policy:{...coverage.source_policy,limit_reached:false}})).toBe(false);
    expect(researchResultHonorsSourcePolicy(policy,sources,{})).toBe(false);
    expect(researchResultHonorsSourcePolicy({},sources,{})).toBe(true);
  });
});
