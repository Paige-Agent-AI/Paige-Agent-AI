// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  VP_ROSTER,
  buildVpAddressBlock,
  detectVpAddress,
} from '../../supabase/functions/_shared/paige-context/vp-address.ts';
import { resolveRoleToolScope } from '../../supabase/functions/_shared/studio-scope.ts';
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

// EXP08 Team Hub agents A1a (owner, 2026-10-27): MERIT and NEXUS follow the binding 23 Oct 2026 roster
// standard, here and on their platform rows (migration 20271117010108), and say the same thing in both.
describe("the 23 Oct roster standard: MERIT is Sales & getting paid, NEXUS is Marketing & growth", () => {
  const migration = readFileSync("supabase/migrations/20271117010108_exp08_team_hub_agents_roster.sql", "utf8");
  const vp = (slug: string) => VP_ROSTER.find((v) => v.slug === slug)!;
  it("MERIT owns sales, proposals, agreements and getting paid, and is not a finance specialist", () => {
    expect(vp("merit").role).toBe("VP Sales & Getting Paid");
    expect(vp("merit").scope).toMatch(/proposals, agreements/);
    expect(vp("merit").scope).not.toMatch(/dunning|hiring|comp\b|Money spine/);
    expect(looksLikeFinanceAgent({ domain: "sales_getting_paid", name: "MERIT", description: vp("merit").scope })).toBe(false);
    expect(migration).toContain("role = 'VP Sales & Getting Paid'");
  });
  it("NEXUS owns marketing and campaigns; sales sequences and the pipeline are MERIT's", () => {
    expect(vp("nexus").role).toBe("VP Marketing & Growth");
    expect(vp("nexus").scope).not.toMatch(/sales sequences|pipeline management|lead scoring/);
    expect(migration).toContain("role = 'VP Marketing & Growth'");
  });
  it("the other four remits are unchanged by A1a", () => {
    expect(VP_ROSTER.map((v) => [v.slug, v.role])).toEqual([
      ["vera", "VP Intelligence, Finance & Risk"], ["nexus", "VP Marketing & Growth"], ["cura", "VP Client Success"],
      ["mentor", "VP Discovery, Education & Strategy"], ["merit", "VP Sales & Getting Paid"], ["zion", "VP Operations & Automation"]]);
  });
});

// A1a: the scopes the roster migration stores are read by the platform's one role-scope reader
// (resolveRoleToolScope), so A1b needs no second parser; the channel allowlist carries no private read.
describe("the roster migration's Team Hub scopes are valid for the one scope reader", () => {
  const sql = readFileSync("supabase/migrations/20271117010108_exp08_team_hub_agents_roster.sql", "utf8");
  const rows = [...sql.matchAll(/\('(\w+)', \$j\$(.+?)\$j\$::jsonb, \$j\$(.+?)\$j\$::jsonb, \$j\$(.+?)\$j\$::jsonb\)/g)]
    .map((m) => ({ slug: m[1], personality: JSON.parse(m[2]), teamHubTools: JSON.parse(m[3]), scope: JSON.parse(m[4]) }));
  const PRIVATE = ["team_hub_conversations", "team_hub_search", "crm_search_contacts", "crm_list_team", "list_subagents",
    "web_search", "web_fetch", "get_business_snapshot", "read_business_metric", "read_calendar_agenda", "crm_list_deals"];
  it("covers exactly the six specialists", () => {
    expect(rows.map((r) => r.slug)).toEqual(["vera", "nexus", "cura", "mentor", "merit", "zion"]);
  });
  it("each DM scope and each channel allowlist reads as a valid allowlist", () => {
    for (const r of rows) {
      expect(resolveRoleToolScope({ capability_scope: r.scope }).valid).toBe(true);
      expect(resolveRoleToolScope({ capability_scope: r.teamHubTools }).valid).toBe(true);
    }
  });
  it("the channel allowlist is the same §6 list for every agent and names no private read", () => {
    for (const r of rows) {
      expect(r.teamHubTools.tools).toEqual(["team_hub_read_conversation", "read_business_time_zone", "ask_choices",
        "capability_status", "marketplace_browse", "list_event_kinds", "team_hub_answer_privately"]);
      expect(r.teamHubTools.tools.some((t: string) => PRIVATE.includes(t))).toBe(false);
    }
  });
  it("each personality is presentation only and carries no finance-default wording outside MERIT's own getting-paid remit", () => {
    for (const r of rows) {
      expect(Object.keys(r.personality).sort()).toEqual(["energy", "formality", "house_words", "humour", "intro", "length",
        "never_does", "role_line", "shared_rules", "short_role", "sounds_like", "things_to_avoid", "version", "warmth"]);
      expect(JSON.stringify(r.personality)).not.toMatch(/credit|funding|loan|lend|financing|collections/i);
    }
  });
});
