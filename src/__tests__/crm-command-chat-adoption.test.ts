import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CRM_ACTION_CAPABILITY,
  CRM_COMMAND_CANONICAL_IDENTITY_FIELD,
  CRM_COMMAND_TOOLS,
  CRM_TOOL_TO_ACTION,
  canonicalizeCrmCommand,
  crmContactCreateNameIssue,
  crmApprovalSubject,
  crmCommandExecutionPayload,
  crmCommandFallbackIdempotencyKeys,
  crmCommandFingerprintArgs,
} from "../../supabase/functions/_shared/crm-command/catalog.ts";
import { canonicalizePersonName } from "../../supabase/functions/_shared/canonical-person-name.ts";
import { confirmFingerprint } from "../../supabase/functions/_shared/confirm-fingerprint.ts";

const chat = readFileSync("supabase/functions/paige-ai-chat/index.ts", "utf8");

describe("Paige Chat canonical CRM adoption", () => {
  it("exposes every supported operation from one shared catalogue", () => {
    expect(Object.keys(CRM_ACTION_CAPABILITY)).toHaveLength(32);
    expect(CRM_COMMAND_TOOLS).toHaveLength(32);
    expect(new Set(CRM_COMMAND_TOOLS.map((tool) => tool.function.name)).size).toBe(32);
    for (const [action, tool] of Object.entries(CRM_ACTION_CAPABILITY)) expect(CRM_TOOL_TO_ACTION[tool]).toBe(action);
    expect(chat).toContain("toolDefs.push(...CRM_COMMAND_TOOLS as any)");
    const dealUpdate = CRM_COMMAND_TOOLS.find((tool) => tool.function.name === "crm_update_deal");
    expect(dealUpdate?.function.parameters).toMatchObject({
      type: "object",
      required: ["deal_id", "expected_version"],
      properties: expect.objectContaining({
        title: expect.any(Object),
        value_cents: expect.any(Object),
        stage_id: expect.any(Object),
        expected_close_date: expect.any(Object),
        contact_id: expect.any(Object),
        owner_user_id: expect.any(Object),
        currency: expect.any(Object),
      }),
    });
    expect(dealUpdate?.function.parameters).not.toHaveProperty("anyOf");
  });

  it("uses one stable record subject to disambiguate same-tool approval batches", async () => {
    const first = await crmApprovalSubject("task.cancel", { action: "task.cancel", task_id: "task-a", expected_updated_at: "v1" });
    const reordered = await crmApprovalSubject("task.cancel", { expected_updated_at: "v1", task_id: "task-a", action: "task.cancel" });
    const second = await crmApprovalSubject("task.cancel", { action: "task.cancel", task_id: "task-b", expected_updated_at: "v1" });
    const changedVersion = await crmApprovalSubject("task.cancel", { action: "task.cancel", task_id: "task-a", expected_updated_at: "v2" });
    expect(first).toBe(reordered);
    expect(first).not.toBe(second);
    expect(first).toBe(changedVersion);
    expect(first).toMatch(/^[0-9a-f]{16}$/);
  });

  it("publishes the canonical create-contact patch instead of the legacy free-form shape", () => {
    const createContact = CRM_COMMAND_TOOLS.find((tool) => tool.function.name === "crm_create_contact");
    const patch = createContact?.function.parameters.properties.patch;
    expect(patch).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["first_name", "last_name"],
      properties: {
        first_name: expect.any(Object),
        last_name: expect.any(Object),
        contact_methods: expect.any(Object),
        lifecycle_stage: {
          type: "string",
          enum: [
            "new_lead", "qualified", "nurturing", "hot_lead", "negotiating", "won",
            "client_active", "client_paused", "client_churned", "client_funded", "client_alumni",
          ],
        },
      },
    });
    expect(patch).not.toHaveProperty("properties.name");
    // The generated registry (contact-methods series) replaced the bare email/phone fields with
    // contact_methods; the merged schema keeps that removal while carrying the INT-140 name
    // requirements. Either regression — bare phone returning, or contact_methods dropping —
    // must fail here.
    expect(patch).not.toHaveProperty("properties.email");
    expect(patch).not.toHaveProperty("properties.phone");
  });

  it("canonicalizes the exact legacy create-contact shape before approval or execution", async () => {
    const legacy = {
      action: "contact.create",
      patch: {
        name: "Avery Quinn",
        phone: "+1 555 010 0199",
        lifecycle_stage: "lead",
      },
    };
    const canonical = canonicalizeCrmCommand(legacy);

    expect(canonical).toEqual({
      action: "contact.create",
      patch: {
        first_name: "Avery",
        last_name: "Quinn",
        phone: "+1 555 010 0199",
        lifecycle_stage: "new_lead",
      },
    });
    expect(legacy.patch).toHaveProperty("name", "Avery Quinn");
    expect(await crmApprovalSubject("contact.create", legacy)).toBe(
      await crmApprovalSubject("contact.create", canonical),
    );
  });

  it("preserves explicit canonical names and leaves unknown malformed fields to fail closed", () => {
    expect(canonicalizeCrmCommand({
      action: "contact.create",
      patch: { name: "Ignored Alias", first_name: "Canonical", last_name: "Person" },
    })).toEqual({
      action: "contact.create",
      patch: { first_name: "Canonical", last_name: "Person" },
    });
    expect(canonicalizeCrmCommand({
      action: "contact.create",
      patch: { name: 42, nickname: "A.Q." },
    })).toEqual({
      action: "contact.create",
      patch: { name: 42, nickname: "A.Q." },
    });
  });

  it("keeps a usable legacy name when a present canonical name is malformed", () => {
    for (const malformedCanonicalName of [
      { first_name: null },
      { first_name: "   " },
      { last_name: 42 },
    ]) {
      const command = {
        action: "contact.create",
        patch: { name: "Avery Quinn", ...malformedCanonicalName, email: "avery@example.test" },
      };
      expect(canonicalizeCrmCommand(command)).toEqual({
        action: "contact.create",
        patch: {
          first_name: "Avery",
          last_name: "Quinn",
          email: "avery@example.test",
        },
      });
    }

    expect(canonicalizeCrmCommand({
      action: "contact.create",
      patch: { name: "Avery Quinn", first_name: null, last_name: "Existing" },
    })).toEqual({
      action: "contact.create",
      patch: { first_name: "Avery", last_name: "Existing" },
    });
    expect(canonicalizeCrmCommand({
      action: "contact.create",
      patch: { name: "Avery Quinn", first_name: "Existing", last_name: 42 },
    })).toEqual({
      action: "contact.create",
      patch: { first_name: "Existing", last_name: "Quinn" },
    });
  });

  it("fills an absent canonical name part from the usable legacy alias", () => {
    expect(canonicalizeCrmCommand({
      action: "contact.create",
      patch: { name: "Avery Quinn", first_name: "Avery" },
    })).toEqual({
      action: "contact.create",
      patch: { first_name: "Avery", last_name: "Quinn" },
    });
    expect(canonicalizeCrmCommand({
      action: "contact.create",
      patch: { name: "Avery Quinn", last_name: "Quinn" },
    })).toEqual({
      action: "contact.create",
      patch: { first_name: "Avery", last_name: "Quinn" },
    });
  });

  it("refuses a mononym instead of allowing the executor to invent a surname", () => {
    const legacyMononym = canonicalizeCrmCommand({
      action: "contact.create",
      patch: { name: "Prince" },
    });
    const canonicalMononym = canonicalizeCrmCommand({
      action: "contact.create",
      patch: { first_name: "Prince" },
    });
    const completeName = canonicalizeCrmCommand({
      action: "contact.create",
      patch: { first_name: "Avery", last_name: "Quinn" },
    });

    expect(crmContactCreateNameIssue(legacyMononym)).toBe("last_name");
    expect(crmContactCreateNameIssue(canonicalMononym)).toBe("last_name");
    expect(crmContactCreateNameIssue(completeName)).toBeNull();
    expect(crmContactCreateNameIssue({ action: "contact.update" })).toBeNull();
  });

  it("does not accept tenant, actor, role, account, approval, or authority as model arguments", () => {
    const serialized = JSON.stringify(CRM_COMMAND_TOOLS);
    for (const forbidden of ["tenant_id", "actor_id", "actor_role", "account_id", "approved_fingerprint", "authority"]) {
      expect(serialized).not.toContain(`\\"${forbidden}\\":`);
    }
  });

  it("removes legacy model exposure and routes canonical tools only through crm-command", () => {
    expect(chat).toContain("legacyCrmMutationTools");
    expect(chat).toContain('functions.invoke("crm-command"');
    expect(chat).toContain("headers: { Authorization: authHeader }");
    expect(chat).toContain("CRM_COMMAND_TOOL_NAMES.has(tc.function.name as any)");
    expect(chat).toContain("&& !CRM_COMMAND_TOOL_NAMES.has(tc.function.name as any)");
  });

  it("adopts the command door approval and truthful result contract", () => {
    expect(chat).toContain('crmBody.outcome === "approval_required"');
    expect(chat).toContain("confirm_fingerprint: crmBody.fingerprint");
    // C4b: the publish door's own proposals are declined through the same NULL-scope seam.
    expect(chat).toContain('.in("tool_name", [...CRM_COMMAND_TOOL_NAMES, ...SALES_INVOICE_TOOL_NAMES, ...SALES_COLLECTIONS_TOOL_NAMES, ...GROWTH_PUBLISH_DOOR_TOOL_NAMES])');
    expect(chat).toContain("Nothing changed yet");
    expect(chat).toContain("external_effect: false");
    expect(chat).toContain("No email or SMS was sent and no call was placed");
    expect(chat).toContain("paige_crm_result");
    expect(chat).toContain("crmResultTrace");
    expect(chat).toContain("paige_crm_result: crmResultTrace.map");
    // Success and interrupted Live now share this one projection, before convo.
    const persistedCrmProjection = chat.slice(chat.indexOf("paige_crm_result: crmResultTrace.map"), chat.indexOf("const convo:", chat.indexOf("paige_crm_result: crmResultTrace.map")));
    expect(persistedCrmProjection).not.toContain("readback:");
    expect(persistedCrmProjection).not.toContain("record_locator:");
    expect(chat).toContain("receipt_recorded: parsed.receipt_recorded === true");
    expect(chat).toContain("crmCommandFallbackIdempotencyKeys(canonicalCrmCommand, sourceCrmCommand");
    expect(chat).toContain("user_turn_ordinal: userTurns.length");
    expect(chat).toContain("user_turn: currentUserTurn?.content ?? null");
    expect(chat).not.toContain("tool_index: toolIndex");
    expect(chat).not.toContain("thread_id: payloadThreadId ?? null,\n            messages,");
    expect(chat).toContain("for (const src of [out?.readback, out, args])");
    expect(chat).toContain('crm_log_activity: "client_notes"');
    // The approval-subject narrowing moved from an SQL GATE on this query to a PREFERENCE over its
    // candidates (2026-09-25). The old equality was computed from the MODEL's re-emitted arguments,
    // and a *.create has no stable record id, so any drift on the approval turn returned zero rows
    // and an approved create was refused with nothing created (prod: 3 of 4 crm_create_contact and
    // 2 of 2 deal_create approvals stranded). What still binds — and is what this line now pins —
    // is that the candidates are ONLY the fingerprints the human echoed back, and that the
    // resolution order lives in the one shared, unit-tested home. Behaviour: see
    // crm-approval-resolution.test.ts; wiring: see crm-approval-door-wiring.test.ts.
    expect(chat).toContain('.in("fingerprint", [...approvedConfirmations].map((token) => token.split(":")[0]))');
    expect(chat).toContain("resolveCrmApprovedFingerprint(approvedRows ?? [], approvalSubject, sameToolCallsThisTurn)");
    expect(chat).toContain("if (approvedConfirmations.has(resolved.fingerprint)) approvedFingerprint = resolved.fingerprint;");
    expect(chat).not.toContain("const idempotencyKey = suppliedKey || crypto.randomUUID()");
  });

  it("canonicalizes equivalent CRM retries before both hashing and invocation", async () => {
    const sourceAt = chat.indexOf("const sourceCrmCommand = { action, ...crmArgs }");
    const canonicalizeAt = chat.indexOf("const canonicalCrmCommand = canonicalizeCrmCommand(sourceCrmCommand)");
    const identityAt = chat.indexOf("const fallbackKeys = await crmCommandFallbackIdempotencyKeys", canonicalizeAt);
    const hashAt = chat.indexOf('const idempotencyKey = action === "contact.create"', canonicalizeAt);
    const invokeAt = chat.indexOf('functions.invoke("crm-command"', canonicalizeAt);

    expect(chat).toContain("canonicalizeCrmCommand");
    expect(sourceAt).toBeGreaterThan(-1);
    expect(canonicalizeAt).toBeGreaterThan(sourceAt);
    expect(identityAt).toBeGreaterThan(canonicalizeAt);
    expect(hashAt).toBeGreaterThan(identityAt);
    expect(invokeAt).toBeGreaterThan(hashAt);
    expect(chat).toContain('const idempotencyKey = action === "contact.create"\n            ? fallbackKeys.current\n            : (suppliedKey || fallbackKeys.current)');
    expect(chat).toContain("body: { command: canonicalCrmCommand, idempotency_key: idempotencyKey");
    expect(chat).not.toContain("body: { command: { action, ...crmArgs }, idempotency_key: idempotencyKey");

    const legacy = canonicalizeCrmCommand({
      action: "contact.create",
      patch: { name: "Avery Quinn", lifecycle_stage: "lead" },
    });
    const canonical = canonicalizeCrmCommand({
      action: "contact.create",
      patch: { first_name: "Avery", last_name: "Quinn", lifecycle_stage: "new_lead" },
    });
    expect(legacy).toEqual(canonical);

    const fallbackKey = async (command: Record<string, unknown>) => {
      const normalized = canonicalizeCrmCommand(command);
      const args = Object.fromEntries(Object.entries(normalized).filter(([key]) => key !== "action"));
      return await confirmFingerprint("crm_command_idempotency", {
        thread_id: "test-thread",
        user_turn_ordinal: 1,
        user_turn: "Add Avery Quinn as a lead",
        tool_name: "crm_create_contact",
        arguments: args,
      });
    };
    expect(await fallbackKey(legacy)).toBe(await fallbackKey(canonical));
  });

  it("gives every equivalent contact-name spelling one retry key", async () => {
    const variants = [
      { label: "canonical", patch: { first_name: "José", last_name: "Quinn", lifecycle_stage: "new_lead" } },
      { label: "leading space", patch: { first_name: "  José", last_name: "Quinn", lifecycle_stage: "new_lead" } },
      { label: "trailing space", patch: { first_name: "José  ", last_name: "Quinn   ", lifecycle_stage: "new_lead" } },
      { label: "mixed case", patch: { first_name: "jOsÉ", last_name: "QUINN", lifecycle_stage: "new_lead" } },
      { label: "non-breaking space alias", patch: { name: "José Quinn", lifecycle_stage: "lead" } },
      { label: "zero-width characters", patch: { first_name: "Jo​s﻿é", last_name: "Qu⁠inn", lifecycle_stage: "new_lead" } },
      { label: "decomposed unicode", patch: { first_name: "José", last_name: "Quinn", lifecycle_stage: "new_lead" } },
      { label: "lifecycle alias", patch: { first_name: "José", last_name: "Quinn", lifecycle_stage: "lead" } },
      { label: "legacy alias", patch: { name: "  José   Quinn  ", lifecycle_stage: "lead" } },
    ] as const;
    const keys = await Promise.all(variants.map(async ({ patch }) => {
      const command = canonicalizeCrmCommand({ action: "contact.create", patch });
      return await confirmFingerprint("crm_command_idempotency", {
        thread_id: "test-thread",
        user_turn_ordinal: 1,
        user_turn: "Add José Quinn as a lead",
        tool_name: "crm_create_contact",
        arguments: crmCommandFingerprintArgs(command),
      });
    }));

    const keysByVariant = Object.fromEntries(variants.map(({ label }, index) => [label, keys[index]]));
    expect(new Set(keys), JSON.stringify(keysByVariant)).toEqual(new Set([keys[0]]));
    expect(() => crmCommandFingerprintArgs({
      action: "contact.create",
      patch: { first_name: "José", last_name: "Quinn" },
    } as never)).toThrow("CRM_COMMAND_NOT_CANONICAL");
  });

  it("defines one complete display and identity form for person names", () => {
    const cases = [
      { input: "Straße", display: "Straße", identity: "strasse" },
      { input: "STRASSE", display: "STRASSE", identity: "strasse" },
      { input: "ΟΣ", display: "ΟΣ", identity: "οσ" },
      { input: "ος", display: "ος", identity: "οσ" },
      { input: "οσ", display: "οσ", identity: "οσ" },
      { input: "Ꭰ", display: "Ꭰ", identity: "Ꭰ" },
      { input: "ꭰ", display: "ꭰ", identity: "Ꭰ" },
      { input: "ı", display: "ı", identity: "ı" },
      { input: "  José   Quinn  ", display: "José Quinn", identity: "josé quinn" },
      { input: "JOSÉ QUINN", display: "JOSÉ QUINN", identity: "josé quinn" },
      { input: "José Quinn", display: "José Quinn", identity: "josé quinn" },
      { input: "Jo​s​é Qu⁠i\ufeffnn", display: "Jo​s​é Qu⁠i\ufeffnn", identity: "josé quinn" },
      { input: "می‌ر क्‍ष᠎ᠠ", display: "می‌ر क्‍ष᠎ᠠ", identity: "می‌ر क्‍ष᠎ᠠ" },
    ] as const;
    for (const value of cases) expect(canonicalizePersonName(value.input)).toEqual({
      display: value.display,
      identity: value.identity,
    });
    for (const malformed of [null, 42, "   ", "\u200b\u2060\ufeff", "\u200c\u200d\u180e"]) {
      expect(canonicalizePersonName(malformed)).toBeNull();
    }
  });

  it("gives every full-Unicode caseless spelling in a logical name class one retry key", async () => {
    const equivalentNameClasses = [
      ["Straße", "STRASSE"],
      ["ΟΣ", "ος", "οσ"],
      ["Ꭰ", "ꭰ"],
    ] as const;

    for (const lastNames of equivalentNameClasses) {
      const keys = await Promise.all(lastNames.map(async (lastName) => {
        const command = canonicalizeCrmCommand({
          action: "contact.create",
          patch: { first_name: "Avery", last_name: lastName, lifecycle_stage: "new_lead" },
        });
        return await confirmFingerprint("crm_command_idempotency", {
          thread_id: "test-thread",
          user_turn_ordinal: 1,
          user_turn: "Add this contact",
          tool_name: "crm_create_contact",
          arguments: crmCommandFingerprintArgs(command),
        });
      }));
      expect(new Set(keys), JSON.stringify({ lastNames, keys })).toHaveLength(1);
    }
  });

  it("keeps the database replay projection aligned with every equivalent retry spelling", async () => {
    const commands = [
      canonicalizeCrmCommand({
        action: "contact.create",
        patch: { first_name: "José", last_name: "Quinn", lifecycle_stage: "new_lead" },
      }),
      canonicalizeCrmCommand({
        action: "contact.create",
        patch: { first_name: "  jOsÉ  ", last_name: "QUINN", lifecycle_stage: "lead" },
      }),
      canonicalizeCrmCommand({
        action: "contact.create",
        patch: { name: "José Quinn", lifecycle_stage: "lead" },
      }),
    ];

    const databaseHashInputs = await Promise.all(commands.map(async (command) => {
      const payload = crmCommandExecutionPayload(command);
      return await confirmFingerprint("crm_database_replay", {
        command: payload[CRM_COMMAND_CANONICAL_IDENTITY_FIELD] as Record<string, unknown>,
        approval_channel: "standing_autonomy_setting",
      });
    }));
    expect(new Set(databaseHashInputs)).toHaveLength(1);
    expect(() => crmCommandExecutionPayload({
      action: "contact.create",
      patch: { first_name: "José", last_name: "Quinn" },
    } as never)).toThrow("CRM_COMMAND_NOT_CANONICAL");

    const previewCommand = canonicalizeCrmCommand({
      action: "contact.hard_delete",
      contact_id: "00000000-0000-4000-8000-000000000001",
      expected_updated_at: "2026-09-23T12:00:00.000Z",
    });
    expect(crmCommandExecutionPayload(previewCommand)).toBe(previewCommand);
    expect(crmCommandExecutionPayload(previewCommand)).not.toHaveProperty(CRM_COMMAND_CANONICAL_IDENTITY_FIELD);
  });

  it("preserves the exact pre-normalization display command for a cross-deploy replay", () => {
    const preMigrationCommand = {
      action: "contact.create",
      patch: {
        first_name: "  Jose\u0301 ",
        last_name: " Quinn ",
        lifecycle_stage: "new_lead",
      },
    };
    const canonicalCommand = canonicalizeCrmCommand(preMigrationCommand);
    const replayPayload = crmCommandExecutionPayload(canonicalCommand, preMigrationCommand);

    expect(replayPayload).toMatchObject({
      action: "contact.create",
      patch: { first_name: "José", last_name: "Quinn", lifecycle_stage: "new_lead" },
      [CRM_COMMAND_CANONICAL_IDENTITY_FIELD]: expect.any(Object),
      __paige_legacy_display_v1: preMigrationCommand,
    });
    expect(preMigrationCommand.patch.first_name).toBe("  Jose\u0301 ");
    expect(() => crmCommandExecutionPayload(canonicalCommand, {
      action: "contact.create",
      patch: { first_name: "Different", last_name: "Person", lifecycle_stage: "new_lead" },
    })).toThrow("CRM_COMMAND_LEGACY_REPLAY_MISMATCH");
    expect(chat).toContain("const sourceCrmCommand = { action, ...crmArgs }");
    expect(chat).toContain("crmCommandFallbackIdempotencyKeys(canonicalCrmCommand, sourceCrmCommand");
    expect(chat).toContain("legacy_command: legacyCrmCommand");
  });

  it("preserves the pre-canonicalization fallback key for a cross-deploy replay", async () => {
    const sourceCommand = {
      action: "contact.create",
      patch: {
        first_name: "  José ",
        last_name: " Quinn ",
        lifecycle_stage: "new_lead",
      },
    };
    const canonicalCommand = canonicalizeCrmCommand(sourceCommand);
    const context = {
      thread_id: "test-thread",
      user_turn_ordinal: 1,
      user_turn: "Add José Quinn as a lead",
      tool_name: "crm_create_contact",
    };
    const keys = await crmCommandFallbackIdempotencyKeys(canonicalCommand, sourceCommand, context);
    const legacyKeyBeforeCanonicalization = await confirmFingerprint("crm_command_idempotency", {
      ...context,
      arguments: sourceCommand.patch ? { patch: sourceCommand.patch } : {},
    });

    expect(keys.current).not.toBe(legacyKeyBeforeCanonicalization);
    expect(keys.legacy).toBe(legacyKeyBeforeCanonicalization);
    expect(keys.legacyCommand).toEqual(sourceCommand);
    expect(chat).toContain("crmCommandFallbackIdempotencyKeys(canonicalCrmCommand, sourceCrmCommand");
    expect(chat).toContain("legacy_idempotency_key: fallbackKeys.legacy");
  });

  it("does not let a newly emitted model key bypass canonical and legacy contact-create replay", () => {
    expect(chat).toContain('const idempotencyKey = action === "contact.create"\n            ? fallbackKeys.current\n            : (suppliedKey || fallbackKeys.current)');
    expect(chat).toContain("...(fallbackKeys.legacy ? { legacy_idempotency_key: fallbackKeys.legacy } : {})");
    expect(chat).not.toContain("...(!suppliedKey && fallbackKeys.legacy ? { legacy_idempotency_key: fallbackKeys.legacy } : {})");
  });

  it("keeps a pre-rollout supplied contact-create key as readback-only compatibility", async () => {
    const sourceCommand = {
      action: "contact.create",
      patch: { first_name: " Avery ", last_name: " Quinn " },
    };
    const canonicalCommand = canonicalizeCrmCommand(sourceCommand);
    const keys = await crmCommandFallbackIdempotencyKeys(canonicalCommand, sourceCommand, {
      thread_id: "test-thread",
      user_turn_ordinal: 1,
      user_turn: "Add Avery Quinn",
      tool_name: "crm_create_contact",
    });
    const preRolloutSuppliedKey = "model-key-before-canonical-rollout";

    expect(preRolloutSuppliedKey).not.toBe(keys.current);
    expect(chat).toContain('const legacySuppliedIdempotencyKey = action === "contact.create"');
    expect(chat).toContain("suppliedKey !== fallbackKeys.current");
    expect(chat).toContain("legacy_supplied_idempotency_key: legacySuppliedIdempotencyKey");
    expect(chat).toContain('const idempotencyKey = action === "contact.create"\n            ? fallbackKeys.current');
    expect(chat).not.toMatch(/(?:^|[{,]\s*)idempotency_key:\s*legacySuppliedIdempotencyKey/m);
  });

  it("preserves meaningful orthographic join controls in the stored display form", () => {
    const command = canonicalizeCrmCommand({
      action: "contact.create",
      patch: {
        first_name: "می‌ر",
        last_name: "क्‍ष᠎ᠠ",
      },
    });
    expect(command).toEqual({
      action: "contact.create",
      patch: {
        first_name: "می‌ر",
        last_name: "क्‍ष᠎ᠠ",
      },
    });
    const identityPatch = crmCommandFingerprintArgs(command).patch as Record<string, unknown>;
    expect(identityPatch.first_name).toBe("می‌ر");
    expect(identityPatch.last_name).toBe("क्‍ष᠎ᠠ");
  });

  it("does not resolve inherited object keys as lifecycle aliases", () => {
    for (const lifecycleStage of ["constructor", "toString", "__proto__"]) {
      const command = canonicalizeCrmCommand({
        action: "contact.create",
        patch: { first_name: "Avery", lifecycle_stage: lifecycleStage },
      });
      expect(command).toEqual({
        action: "contact.create",
        patch: { first_name: "Avery", lifecycle_stage: lifecycleStage },
      });
    }
  });
});
