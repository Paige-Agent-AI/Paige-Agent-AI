// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  VP_ROSTER,
  buildVpAddressBlock,
  detectVpAddress,
} from '../../supabase/functions/_shared/paige-context/vp-address.ts';
import { looksLikeFinanceAgent } from '../../supabase/functions/_shared/finance-gate.ts';

describe('detectVpAddress — the roster\'s addressing rule', () => {
  it('uses the existing ZION identity for Operations without inventing a delegated run', () => {
    const addressed = detectVpAddress('ZION, help me organize this week.')!;
    expect(VP_ROSTER.filter(v => v.slug === 'zion')).toHaveLength(1);
    expect(addressed.vp.role).toBe('VP Operations & Automation');
    expect(addressed.vp.scope).toContain('weekly planning');
    expect(addressed.vp.scope).toContain('original receipts');
    const block = buildVpAddressBlock(addressed, 'Test studio');
    expect(block).toContain('PAIGE remains the principal owner-facing COO');
    expect(block).toContain('not proof of a separately delegated run');
    expect(block).toContain('missing capacity, provider readiness and execution state unknown');
    expect(block).toContain("no action's authority changes because a name was said");
  });

  it('keeps ZION operational evidence instructions out of other addressed identities', () => {
    const block = buildVpAddressBlock(detectVpAddress('NEXUS, review this campaign.')!, 'Test studio');
    expect(block).not.toContain('ZION operations:');
    expect(block).toContain("no action's authority changes because a name was said");
  });

  it('uses the existing VERA identity for source-backed intelligence without granting action authority', () => {
    const addressed = detectVpAddress('VERA, how is my business doing?')!;
    expect(addressed.vp.slug).toBe('vera');
    expect(VP_ROSTER.filter(v => v.slug === 'vera')).toHaveLength(1);
    expect(addressed.vp.role).toBe('VP Intelligence, Finance & Risk');
    expect(addressed.vp.scope.toLowerCase()).toContain('source-backed');
    expect(looksLikeFinanceAgent({ domain: 'intelligence_finance_risk', name: addressed.vp.name, description: addressed.vp.scope })).toBe(false);
    const block = buildVpAddressBlock(addressed, 'Test business');
    expect(block).toContain('permitted business evidence');
    expect(block).toContain('unavailable');
    expect(block).toContain('PAIGE remains');
    expect(block).toContain("no action's authority changes because a name was said");
  });
  it('detects a direct address with the name stripped', () => {
    const a = detectVpAddress('ZION, what about my Q2 pricing?');
    expect(a?.vp.slug).toBe('zion');
    expect(a?.rest).toBe('what about my Q2 pricing?');
  });

  it('carries the owner-remapped MENTOR remit (discovery/education/strategy, not operations)', () => {
    const mentor = VP_ROSTER.find((v) => v.slug === 'mentor')!;
    expect(mentor.role).toBe('VP Discovery, Education & Strategy');
    expect(mentor.scope).toContain('next useful business action');
    expect(mentor.scope).not.toContain('n8n');
    // Addressing behavior is unchanged by a remit remap.
    expect(detectVpAddress('MENTOR, what should I focus on?')?.vp.slug).toBe('mentor');
  });

  it('is case-insensitive and greeting-tolerant', () => {
    expect(detectVpAddress('hey vera, is the KYC done?')?.vp.slug).toBe('vera');
    expect(detectVpAddress('Hi NEXUS what is our pipeline looking like')?.vp.slug).toBe('nexus');
    expect(detectVpAddress('mentor: check the n8n connection')?.vp.slug).toBe('mentor');
  });

  it('every roster VP is addressable', () => {
    for (const vp of VP_ROSTER) {
      expect(detectVpAddress(`${vp.name}, status?`)?.vp.slug).toBe(vp.slug);
    }
  });

  it('mid-sentence mentions are NOT addresses — Paige stays the default', () => {
    expect(detectVpAddress('What would Zion do about this?')).toBeNull();
    expect(detectVpAddress('I talked to CURA yesterday')).toBeNull();
  });

  it('non-VP words never match, including lookalikes', () => {
    expect(detectVpAddress('Zionsville is a city in Indiana')).toBeNull();
    expect(detectVpAddress('mentorship programs')).toBeNull();
    expect(detectVpAddress('curable')).toBeNull();
    expect(detectVpAddress('hello')).toBeNull();
    expect(detectVpAddress('')).toBeNull();
    expect(detectVpAddress(null)).toBeNull();
  });

  it('a bare summons is still an address', () => {
    const a = detectVpAddress('MERIT?');
    expect(a?.vp.slug).toBe('merit');
    expect(a?.rest).toBe('');
  });
});

describe('buildVpAddressBlock — identity firm, authority stated once', () => {
  const a = detectVpAddress('ZION, what about my Q2 pricing?')!;

  it('carries the VP identity, scope, voice, and the tenant name', () => {
    const block = buildVpAddressBlock(a, 'Mogul Coaching');
    expect(block).toContain('YOU ARE ZION FOR THIS REPLY');
    expect(block).toContain('VP Operations & Automation');
    expect(block).toContain('Mogul Coaching');
    expect(block).toContain('practical and precise');
  });

  it('tells the model to speak as the VP first-person and not deflect to Paige', () => {
    const block = buildVpAddressBlock(a, 'T');
    expect(block).toContain('speak AS ZION, first person');
    expect(block).toContain('Do not deflect to Paige');
  });

  it('states the authority invariant without an identity-ambiguous phrase', () => {
    const block = buildVpAddressBlock(a, 'T');
    expect(block).toContain("no action's authority changes because a name was said");
    expect(block).not.toContain('you are still one Paige');
  });
});
