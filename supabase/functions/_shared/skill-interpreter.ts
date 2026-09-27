// deno-lint-ignore-file no-explicit-any
// _shared/skill-interpreter.ts — the Deno orchestrator for the Skills S1b steps-interpreter.
//
// Pairs with the PURE, unit-tested decision logic in `_shared/skill-interpreter-core.ts`. This file
// holds ONLY the side-effecting orchestration (forge call, context read, approval write) so the core
// stays Deno-free and vitest-testable. §18 — it REUSES the existing `forge()` seam (§26) and the
// existing paige_pending_approvals table; it forks no router, no second generation path, no second
// approvals home.
//
// §16 GUARANTEE: the interpreter has NO external-send call site (no resend, no Twilio). External
// delivery can only ever happen later, from the approved-send seam, after a human approves the draft
// this interpreter files. A skill's autonomy_lane decides whether it returns the output (auto), files
// a draft for approval (confirm), or briefs only (off) — never an autonomous send.

import { forge } from "./prompt-forge.ts";
import {
  type SkillRow,
  type CallerTier,
  type BrowseFn,
  type BrowseObservation,
  type PublicBrowseFn,
  type PublicBrowseObservation,
  resolveExecutionMode,
  mapApprovalRisk,
  tierAllowsSkill,
  needsFormat,
  pickModality,
  pickTier,
  buildForgeIntent,
  pickBrowserStep,
  browserToolAllowed,
  browseGatePermits,
  foldBrowserObservation,
  pickPublicBrowseStep,
  isHttpUrl,
  foldPublicBrowse,
  FORMAT_OPTIONS,
  FORMAT_PROMPT,
} from "./skill-interpreter-core.ts";

export type InterpretStatus =
  | "succeeded"        // auto lane — output produced and returned
  | "awaiting_approval"// confirm lane — draft filed to paige_pending_approvals
  | "brief"            // off lane — brief returned, nothing written/executed
  | "needs_input"      // Slice 4 — paused to ask the user for a format
  | "needs_config"     // honest degrade — generation unavailable or tenant unresolved
  | "denied"           // §60 tier gate denied this tier
  | "failed";          // a real error (forge threw, approval insert failed)

export interface InterpretResult {
  status: InterpretStatus;
  outputs: Record<string, unknown>;
  steps_log: Array<Record<string, unknown>>;
  error?: string | null;
}

export interface InterpretDeps {
  /** The real prompt-forge seam (injected so the core stays testable; here it's the module forge). */
  forge: typeof forge;
  /** A service-role Supabase client. */
  admin: any;
  /**
   * S1b — the FIRST real tool-dispatch seam (§18: MIRRORS `forge`). The interpreter core stays pure +
   * unit-testable; the actual outbound fetch to the paige-browser host lives in the HOST (skill-runner)
   * and is INJECTED here. Absent (or returning { needs_config:true }) → honest needs_config, never a
   * fabricated observation (§13). Read-only observation only — paige-browser rejects write/interact.
   */
  browse?: BrowseFn;
  /**
   * S3b — the PUBLIC-WEB browse seam (§18: a SECOND browse contract distinct from `browse`). Routes a
   * `mode:"public"` step to paige-browser's /browse-public-url (arbitrary public-URL research shape),
   * NOT /self-verify. The actual outbound fetch (30s cap + retry) lives in the HOST (skill-runner) and
   * is INJECTED here so the core stays pure. Absent (or returning { needs_config:true }) → honest
   * needs_config, never a fabricated page (§13). The audit row (paige_browser_usage) is written by THIS
   * caller via `admin` (service_role) — the DB-free Fly host never writes to the DB (§9/§34).
   */
  browsePublic?: PublicBrowseFn;
}

export interface InterpretCtx {
  skill: SkillRow;
  inputs: Record<string, unknown>;
  contactId: string | null;
  /** Server-resolved tenant (body.tenant_id ?? contact.tenant_id) — NEVER a body-trusted auth claim (§9). */
  tenantId: string | null;
  callerTier: CallerTier;
  actorUserId: string | null;
  actorRole: string | null;
  runId: string;
}

const CONTEXT_TOOLS = new Set(["context", "rag", "client_memory"]);

/**
 * Run a skill through the generic interpreter. Returns an honest, structured outcome — it never throws
 * for a policy/degrade case (denied/needs_config/needs_input), only surfaces `failed` with the real
 * error on an actual fault. Every branch pushes to steps_log so the run is auditable.
 */
export async function interpretSkill(deps: InterpretDeps, ctx: InterpretCtx): Promise<InterpretResult> {
  const { skill, inputs, contactId, tenantId, callerTier, actorUserId, actorRole, runId } = ctx;
  const stepsLog: Array<Record<string, unknown>> = [];

  // 1) §60/§61 tier gate (server belt; UI is the primary gate per #466).
  if (!tierAllowsSkill(skill.tier_availability, callerTier)) {
    stepsLog.push({ step: "tier_gate", allowed: false, tier: callerTier });
    return {
      status: "denied",
      outputs: { reason: "tier_not_permitted", tier: callerTier, skill: skill.slug },
      steps_log: stepsLog,
    };
  }

  // 2) Slice 4 (S1d) — a document skill asks for a format before generating (§15/§36).
  if (needsFormat(skill, inputs)) {
    stepsLog.push({ step: "format_picker", field: "format" });
    return {
      status: "needs_input",
      outputs: { field: "format", prompt: FORMAT_PROMPT, options: [...FORMAT_OPTIONS] },
      steps_log: stepsLog,
    };
  }

  // 3) Tenant must be resolved — forge THROWS on a missing tenantId. Honest degrade, never a guess (§9/§13).
  if (!tenantId) {
    stepsLog.push({ step: "tenant_resolve", resolved: false });
    return {
      status: "needs_config",
      outputs: { reason: "tenant_unresolved", note: "Skill needs a tenant to forge under; none was resolved." },
      steps_log: stepsLog,
    };
  }

  // 4) Gather read-only context when the skill asks for it and a contact is in scope. §9 — the contact
  //    read is constrained to the caller's OWN tenant, so a stranger-tenant contact_id yields no context
  //    (never a cross-tenant read) rather than leaking.
  let contextText = "";
  const wantsContext = Array.isArray(skill.steps) && skill.steps.some((s) => CONTEXT_TOOLS.has((s?.tool ?? "").toLowerCase()));
  if (contactId && wantsContext) {
    try {
      const { data: contact } = await deps.admin
        .from("clients")
        .select("id, first_name, last_name, email, tenant_id")
        .eq("id", contactId)
        .eq("tenant_id", tenantId) // §9 — only the caller's own tenant's contact
        .maybeSingle();
      if (contact) {
        const { data: memory } = await deps.admin
          .from("client_memory")
          .select("memory_type, content, created_at")
          .eq("client_id", contactId)
          .order("created_at", { ascending: false })
          .limit(5);
        const memLines = Array.isArray(memory)
          ? memory.map((m: any) => `- ${m.memory_type}: ${String(m.content ?? "").slice(0, 400)}`)
          : [];
        contextText = [
          `Client: ${contact.first_name ?? ""} ${contact.last_name ?? ""}`.trim(),
          ...memLines,
        ].filter(Boolean).join("\n");
        stepsLog.push({ step: "context", memory_count: memLines.length });
      } else {
        stepsLog.push({ step: "context", memory_count: 0, note: "contact not in tenant scope" });
      }
    } catch (e) {
      // Context is best-effort — a read hiccup degrades to no-context, never a failed run (§13).
      console.error(`skill-interpreter[${skill.slug}] context read failed:`, (e as Error)?.message);
      stepsLog.push({ step: "context", memory_count: 0, error: (e as Error)?.message });
    }
  }

  // 4b) S1b — the FIRST real tool-dispatch: a READ-ONLY browser observation folded into the forge
  //     context. This is where allowed_tools becomes ACTUALLY EXECUTED for the first time (a browser
  //     step in the plan is NOT dispatched unless "browser" is also granted in allowed_tools), and
  //     where the §16 risk floor is consulted BEFORE navigating (a write-class skill's browse is gated
  //     ahead of the human, never fired autonomously). The observation is folded into contextText so
  //     it rides into buildForgeIntent — honestly (§13), only the fields the browse actually returned.
  const browserStep = pickBrowserStep(skill);
  if (browserStep) {
    const toolAllowed = browserToolAllowed(skill);
    const gatePermits = browseGatePermits(skill.autonomy_lane, skill.risk_level);
    const url = typeof browserStep.url === "string" ? browserStep.url.trim() : "";
    if (!toolAllowed) {
      // allowed_tools now genuinely gates dispatch — a browser step without the grant is a no-op here.
      stepsLog.push({ step: "browse", dispatched: false, reason: "browser_not_in_allowed_tools" });
    } else if (!gatePermits) {
      // §16 structural floor: the browse is gated before navigating; the run still lands per the clamp.
      stepsLog.push({ step: "browse", dispatched: false, reason: "risk_floor_gated", risk_level: skill.risk_level ?? null });
    } else if (!deps.browse || !url) {
      // Honest degrade (§13/§32) — no browse seam wired, or the step carries no url. Same posture as the
      // forge needs_config branch: surface it, never fabricate an observation.
      stepsLog.push({ step: "browse", dispatched: false, needs_config: true, reason: url ? "no_browse_seam" : "missing_url" });
      return {
        status: "needs_config",
        outputs: { reason: "browser_unavailable", note: "This skill needs the browser seam to observe a page; it is not configured." },
        steps_log: stepsLog,
      };
    } else if (!tenantId) {
      // A service-role browser write without a resolved tenant would be an unattributable act.
      // Refuse before navigation; evidence is mandatory for this path.
      stepsLog.push({ step: "browse", dispatched: false, reason: "tenant_unresolved" });
      return {
        status: "denied",
        outputs: { reason: "tenant_unresolved", note: "The browser request could not be bound to the active workspace." },
        steps_log: stepsLog,
      };
    } else {
      // Dispatch only after the tenant-attributed evidence row exists. The service-role client bypasses
      // RLS, so the DB trigger re-checks related objects against this server-resolved tenant_id.
      const browseSteps = Array.isArray(browserStep.steps) ? browserStep.steps : undefined;
      let ledgerId: string | null = null;
      try {
        const { data: led, error: ledgerError } = await deps.admin
          .from("browser_use_sessions")
          .insert({
            tenant_id: tenantId,
            goal: `skill:${skill.slug} — ${skill.name}`,
            start_url: url,
            steps: browseSteps ?? [],
            related_contact_id: contactId ?? null,
            invoker_kind: "skill", // §37 — browser_use_sessions.invoker_kind CHECK allows admin|coach|paige|skill|system; a skill-driven browse is "skill"
            status: "running",
          })
          .select("id")
          .single();
        if (ledgerError) throw ledgerError;
        ledgerId = (led?.id as string) ?? null;
      } catch (e) {
        // No attributable evidence row means no navigation. A read without its tenant evidence would
        // later be indistinguishable from fabricated or misattributed browser activity.
        console.error(`skill-interpreter[${skill.slug}] browse ledger insert failed:`, (e as Error)?.message);
      }
      if (!ledgerId) {
        stepsLog.push({ step: "browse", dispatched: false, reason: "browser_evidence_unavailable" });
        return {
          status: "failed",
          outputs: { reason: "browser_evidence_unavailable", note: "The browser request was not started because its evidence record could not be created." },
          steps_log: stepsLog,
          error: "browser evidence record unavailable",
        };
      }

      const markLedger = async (fields: Record<string, unknown>): Promise<boolean> => {
        if (!ledgerId) return false;
        try {
          const { data, error } = await deps.admin
            .from("browser_use_sessions")
            .update(fields)
            .eq("id", ledgerId)
            .eq("tenant_id", tenantId)
            .select("id")
            .maybeSingle();
          if (error || !data?.id) throw error ?? new Error("browser evidence row not found");
          return true;
        } catch (e) {
          console.error(`skill-interpreter[${skill.slug}] browse ledger update failed:`, (e as Error)?.message);
          return false;
        }
      };

      let observed: BrowseObservation | null = null;
      try {
        const result = await deps.browse({
          url,
          steps: browseSteps,
          waitForSelector: typeof browserStep.waitForSelector === "string" ? browserStep.waitForSelector : undefined,
          waitMs: typeof browserStep.waitMs === "number" ? browserStep.waitMs : undefined,
        });
        if ((result as { needs_config?: boolean })?.needs_config) {
          const evidenceRecorded = await markLedger({ status: "failed", error: "browser seam needs_config", completed_at: new Date().toISOString() });
          stepsLog.push({ step: "browse", dispatched: false, needs_config: true, ledger_id: ledgerId });
          return {
            status: evidenceRecorded ? "needs_config" : "failed",
            outputs: evidenceRecorded
              ? { reason: "browser_unavailable", note: "The browser seam is not configured on the host." }
              : { reason: "browser_evidence_unavailable", note: "The browser request stopped and its final evidence could not be recorded." },
            steps_log: stepsLog,
            error: evidenceRecorded ? undefined : "browser evidence update unavailable",
          };
        }
        observed = result as BrowseObservation;
      } catch (e) {
        // A browse throw is a real fault — degrade honestly, mark the ledger failed, NEVER fabricate (§13/§32).
        console.error(`skill-interpreter[${skill.slug}] browse threw:`, (e as Error)?.message);
        const evidenceRecorded = await markLedger({ status: "failed", error: (e as Error)?.message ?? "browse threw", completed_at: new Date().toISOString() });
        stepsLog.push({ step: "browse", dispatched: true, ok: false, error: (e as Error)?.message, ledger_id: ledgerId });
        return {
          status: evidenceRecorded ? "needs_config" : "failed",
          outputs: evidenceRecorded
            ? { reason: "browser_unavailable", note: "The browser observation failed." }
            : { reason: "browser_evidence_unavailable", note: "The browser failed and its final evidence could not be recorded." },
          steps_log: stepsLog,
          error: evidenceRecorded ? undefined : "browser evidence update unavailable",
        };
      }

      // Real observation — update the ledger with the honest outcome, then fold it into the forge context.
      const shot = typeof observed.screenshot_b64 === "string" && observed.screenshot_b64 ? [observed.screenshot_b64] : [];
      // §13/efficiency (peer-gate): the screenshot b64 lives in exactly ONE place — the screenshots[]
      // column — so a real screenshot is never persisted twice in the same row. Strip it from result.
      const { screenshot_b64: _b64, ...resultNoShot } = observed as unknown as Record<string, unknown>;
      const evidenceRecorded = await markLedger({
        status: observed.ok ? "succeeded" : "failed",
        result: resultNoShot,
        screenshots: shot,
        duration_ms: typeof observed.duration_ms === "number" ? observed.duration_ms : null,
        error: observed.ok ? null : (observed.error ?? "browse failed"),
        completed_at: new Date().toISOString(),
      });
      if (!evidenceRecorded) {
        stepsLog.push({ step: "browse", dispatched: true, ok: observed.ok, evidence_recorded: false, ledger_id: ledgerId });
        return {
          status: "failed",
          outputs: {
            reason: "browser_evidence_unavailable",
            note: "The page was observed, but Paige could not durably record the final browser evidence.",
            observation_status: observed.ok ? "observed" : "observation_failed",
          },
          steps_log: stepsLog,
          error: "browser evidence update unavailable",
        };
      }
      const folded = foldBrowserObservation(observed);
      if (folded) contextText = contextText ? `${contextText}\n\n${folded}` : folded;
      stepsLog.push({ step: "browse", dispatched: true, ok: observed.ok, http_status: observed.http_status ?? null, ledger_id: ledgerId });
    }
  }

  // 4b') S3b — the PUBLIC-WEB browse dispatch (a `tool:"browser"` step with `mode:"public"`). Distinct
  //      from the self-verify browse above: it routes to paige-browser's /browse-public-url (arbitrary
  //      public-URL research) and writes ONE row to paige_browser_usage — the §17 metered/audit rail —
  //      per call, allowed OR blocked. The URL is RUNTIME INPUT (inputs.url), so this is where a
  //      tenant's chat request ("browse example.com") becomes a real observation. Same §37 allowed_tools
  //      gate + §16 risk floor as the self-verify path; the audit write is a SYSTEM write (service_role
  //      via deps.admin) with tenant_id passed as DATA (ctx.tenantId, already server-resolved) — never
  //      derived from a JWT at write-time, and NEVER written by the DB-free Fly host (§9/§34).
  const publicStep = pickPublicBrowseStep(skill);
  if (publicStep) {
    const toolAllowed = browserToolAllowed(skill);
    const gatePermits = browseGatePermits(skill.autonomy_lane, skill.risk_level);
    const inputUrl = typeof inputs?.url === "string" ? inputs.url.trim() : "";
    const url = inputUrl || (typeof publicStep.url === "string" ? publicStep.url.trim() : "");
    if (!toolAllowed) {
      stepsLog.push({ step: "browse_public", dispatched: false, reason: "browser_not_in_allowed_tools" });
    } else if (!gatePermits) {
      // §16 structural floor: a write-class public-browse skill is gated ahead of the human.
      stepsLog.push({ step: "browse_public", dispatched: false, reason: "risk_floor_gated", risk_level: skill.risk_level ?? null });
    } else if (!isHttpUrl(url)) {
      // No URL, or a non-http(s) URL — surface honestly (§13), don't dispatch a bad request.
      stepsLog.push({ step: "browse_public", dispatched: false, reason: url ? "url_not_http" : "missing_url" });
      return {
        status: "needs_config",
        outputs: { reason: "browse_url_missing", note: "This skill browses a public URL; provide a valid http(s) URL to browse." },
        steps_log: stepsLog,
      };
    } else if (!deps.browsePublic) {
      // Honest degrade (§13/§32) — the public-browse seam isn't wired on this host.
      stepsLog.push({ step: "browse_public", dispatched: false, needs_config: true, reason: "no_browse_seam" });
      return {
        status: "needs_config",
        outputs: { reason: "browser_unavailable", note: "This skill needs the public-browse seam; it is not configured." },
        steps_log: stepsLog,
      };
    } else {
      let observed: PublicBrowseObservation | null = null;
      try {
        const result = await deps.browsePublic({
          url,
          waitForSelector: typeof publicStep.waitForSelector === "string" ? publicStep.waitForSelector : undefined,
          maxContentBytes: typeof publicStep.maxContentBytes === "number" ? publicStep.maxContentBytes : undefined,
        });
        if ((result as { needs_config?: boolean })?.needs_config) {
          // Seam reported unconfigured — honest needs_config, and NO audit row (no call reached the endpoint).
          stepsLog.push({ step: "browse_public", dispatched: false, needs_config: true });
          return {
            status: "needs_config",
            outputs: { reason: "browser_unavailable", note: "The public-browse seam is not configured on the host." },
            steps_log: stepsLog,
          };
        }
        observed = result as PublicBrowseObservation;
      } catch (e) {
        // A dispatch throw is a real fault — degrade honestly, write NO fabricated row (§13/§32).
        console.error(`skill-interpreter[${skill.slug}] public-browse threw:`, (e as Error)?.message);
        stepsLog.push({ step: "browse_public", dispatched: true, ok: false, error: (e as Error)?.message });
        return {
          status: "needs_config",
          outputs: { reason: "browser_unavailable", note: "The public-browse observation failed." },
          steps_log: stepsLog,
        };
      }

      // The endpoint was actually called (allowed OR blocked) — write EXACTLY ONE audit/metered row to
      // paige_browser_usage. §9/§51: tenant_id is EXPLICIT (ctx.tenantId, service-role bypasses RLS, so a
      // NULL would leak the row to every tenant). §13/§32: an audit-write miss is logged LOUDLY and never
      // fabricated nor allowed to block the observation the user asked for (the browse already happened at
      // the Fly host — failing the run here would not un-browse it, and would hide a real user result).
      // §13/§17 audit fidelity (§39 peer-gate M1): the rail reads blocked_reason=null as "allowed", so a
      // HOST transport failure (timeout / host 5xx / navigation-failed — ok:false with NO guard reason)
      // must NOT persist looking identical to a successful allowed browse. Stamp a `host:*` sentinel for
      // any ok:false that carries no explicit SSRF/denylist reason, so the safety surface AND the §17
      // Slice-3c rate meter both count it as a FAILED attempt, not a silent success. A real guard block
      // (ssrf:*/denylist:*/wildcard:disabled) keeps its own reason; a genuine allowed browse stays null.
      const auditBlockedReason = observed.blocked_reason
        ?? (!observed.ok
              ? `host:${String(observed.error ?? (observed.http_status != null ? `http_${observed.http_status}` : "failed")).slice(0, 120)}`
              : null);
      try {
        const { error: auditErr } = await deps.admin.from("paige_browser_usage").insert({
          tenant_id: tenantId,
          endpoint: "browse-public-url",
          url_requested: url,
          url_resolved: observed.final_url ?? null,
          blocked_reason: auditBlockedReason,
          http_status: typeof observed.http_status === "number" ? observed.http_status : null,
          content_bytes: typeof observed.content_bytes === "number" ? observed.content_bytes : null,
          response_time_ms: typeof observed.duration_ms === "number" ? observed.duration_ms : null,
          created_by: actorUserId,
        });
        if (auditErr) {
          console.error(`skill-interpreter[${skill.slug}] paige_browser_usage insert failed:`, auditErr?.message);
          stepsLog.push({ step: "browse_public_audit", ok: false, error: auditErr?.message });
        } else {
          stepsLog.push({ step: "browse_public_audit", ok: true });
        }
      } catch (e) {
        console.error(`skill-interpreter[${skill.slug}] paige_browser_usage insert threw:`, (e as Error)?.message);
        stepsLog.push({ step: "browse_public_audit", ok: false, error: (e as Error)?.message });
      }

      const folded = foldPublicBrowse(observed);
      if (folded) contextText = contextText ? `${contextText}\n\n${folded}` : folded;
      stepsLog.push({
        step: "browse_public",
        dispatched: true,
        ok: observed.ok,
        http_status: observed.http_status ?? null,
        blocked_reason: observed.blocked_reason ?? null,
      });
    }
  }

  // 5) Forge the generative core through the EXISTING §26 seam. remember=false: a skill draft (often
  //    approval-gated) is not a landed design artifact, so it must not pollute the design-memory space
  //    (§26 honest capture — memory is for genuine, landed successes).
  const modality = pickModality(skill);
  const tier = pickTier(skill);
  const userIntent = buildForgeIntent(skill, inputs, contextText);
  let content = "";
  try {
    const forged = await deps.forge({
      tenantId,
      modality,
      tier,
      userIntent,
      actorRole: actorRole ?? undefined,
      actorUserId: actorUserId ?? undefined,
      // §9/§2 — NEVER a platform default here. `scoping` is REGISTRY PROVENANCE (who authored the
      // paige_skills row), NOT the nature of THIS generation. A tenant running a platform-authored
      // skill produces TENANT content for their own book — it is not "authoring the shared/God
      // defaults that ship to everyone." forge's `is_platform_default` gate means the LATTER: it
      // requires an OPERATOR role (assertTenantScope, model-router-gates.ts) and forces the §2
      // finance-in-default ban + §3 platform-voice rewrite on the OUTPUT. Mapping scoping='platform'
      // → is_platform_default=true (the pre-#135 bug) made assertTenantScope THROW §9 for every real
      // caller (skill-runner passes actorRole 'admin'/'mcp'/'member'/'paige'/'system' — none operator),
      // so EVERY seeded platform-baseline skill failed at runtime. It was also a latent §2 over-reach:
      // the finance ban is a PLATFORM-DEFAULT rule, but finance/credit is an ALLOWED per-tenant OPT-IN
      // (§2 clarification) — forcing the default-scan on a tenant's own run would wrongly block a
      // funding-coach tenant from running a generic skill with finance in THEIR brief. The seeded
      // DEFINITION's finance-cleanliness is proven once at seed time (the migration's §2 SQL scan);
      // it does not need re-proving on every tenant execution. So this generation is tenant content:
      is_platform_default: false,
      is_customer_send: false, // interpreter DRAFTS; the send (if any) is a later, human-approved seam (§16)
      callerFunction: `skill-interpreter:${skill.slug}`,
      metadata: { skill_slug: skill.slug, run_id: runId, risk_level: skill.risk_level ?? null },
      remember: false,
    });
    const result = forged.result;
    stepsLog.push({ step: "forge", modality, tier, provider: result.provider ?? null, needs_config: !!result.needs_config });
    if (result.needs_config || !(typeof result.content === "string" && result.content.trim())) {
      return {
        status: "needs_config",
        outputs: { reason: "generation_unavailable", needs_config: !!result.needs_config },
        steps_log: stepsLog,
      };
    }
    content = result.content;
  } catch (e) {
    // LOUD (§32) — a forge throw is a real fault, surfaced not swallowed.
    console.error(`skill-interpreter[${skill.slug}] forge threw:`, (e as Error)?.message);
    return { status: "failed", outputs: {}, steps_log: stepsLog, error: (e as Error)?.message ?? "forge error" };
  }

  // 6) Resolve how the run lands, per the §16 autonomy clamp + the structural risk floor (a
  //    high-risk skill can never auto-execute, even if its lane were mis-seeded to 'auto').
  const mode = resolveExecutionMode(skill.autonomy_lane, skill.risk_level);

  if (mode === "brief") {
    stepsLog.push({ step: "brief", note: "autonomy_lane=off — briefed to a human, not executed" });
    return { status: "brief", outputs: { content }, steps_log: stepsLog };
  }

  if (mode === "approval") {
    // File a draft for a human to approve. Column values are pinned to the REAL table constraints:
    //  • type MUST be in the paige_pending_approvals type CHECK — use 'other' (a skill draft has no
    //    dedicated type); the skill slug lives in draft_content/metadata for identification.
    //  • category is NON-email/sms on purpose so the #465 send-recipient CHECK never applies — a skill
    //    draft is a review item, not a send.
    //  • risk_level uses the approvals vocabulary (low/medium/high/null) via mapApprovalRisk — the
    //    skill's own read_only|draft|mutating|external_send vocabulary would violate the CHECK.
    //  • tenant_id is EXPLICIT (§9/§51) — the service-role client bypasses RLS, so a NULL tenant would
    //    make the row visible to EVERY tenant.
    try {
      const { data: appr, error: apprErr } = await deps.admin
        .from("paige_pending_approvals")
        .insert({
          type: "other",
          category: "skill",
          draft_content: { content, skill_slug: skill.slug, format: (inputs?.format as string) ?? null },
          contact_id: contactId,
          tenant_id: tenantId,
          source: "skill-interpreter",
          risk_level: mapApprovalRisk(skill.risk_level),
          summary: `Paige ran "${skill.name}" — review the draft`,
          metadata: { skill_slug: skill.slug, run_id: runId, methodology_anchor: skill.methodology_anchor ?? null },
        })
        .select("id")
        .single();
      if (apprErr || !appr) {
        console.error(`skill-interpreter[${skill.slug}] approval insert failed:`, apprErr?.message);
        return { status: "failed", outputs: { content }, steps_log: stepsLog, error: apprErr?.message ?? "approval insert failed" };
      }
      stepsLog.push({ step: "approval", approval_id: appr.id });
      return { status: "awaiting_approval", outputs: { content, approval_id: appr.id }, steps_log: stepsLog };
    } catch (e) {
      console.error(`skill-interpreter[${skill.slug}] approval threw:`, (e as Error)?.message);
      return { status: "failed", outputs: { content }, steps_log: stepsLog, error: (e as Error)?.message ?? "approval error" };
    }
  }

  // mode === "execute" (🟢 auto). The ONLY side effect permitted here is an INTERNAL memory save — the
  // interpreter never sends externally. Save when the skill's plan includes an internal save step.
  const hasSaveStep = Array.isArray(skill.steps) &&
    skill.steps.some((s) => (s?.tool ?? "").toLowerCase() === "client_memory" && /save|store|record/i.test(s?.desc ?? ""));
  if (contactId && hasSaveStep) {
    try {
      await deps.admin.from("client_memory").insert({
        client_id: contactId,
        memory_type: `skill:${skill.slug}`,
        content,
        metadata: { run_id: runId, source: "skill-interpreter" },
      });
      stepsLog.push({ step: "save_memory", ok: true });
    } catch (e) {
      // A memory-save miss doesn't fail the run — the output still succeeded (§13).
      console.error(`skill-interpreter[${skill.slug}] memory save failed:`, (e as Error)?.message);
      stepsLog.push({ step: "save_memory", ok: false, error: (e as Error)?.message });
    }
  }

  return { status: "succeeded", outputs: { content }, steps_log: stepsLog };
}
