import { describe, it } from "https://deno.land/std@0.190.0/testing/bdd.ts";
import assert from "node:assert/strict";
import { sha256Hex } from "./token.ts";
import { PDFDocument } from "npm:pdf-lib@1.17.1";
const expect = (value: unknown) => ({
  toEqual: (other: unknown) => assert.deepEqual(value, other),
  toBe: (other: unknown) => assert.equal(value, other),
  toHaveLength: (length: number) =>
    assert.equal((value as { length: number }).length, length),
  toContain: (text: string) => assert(String(value).includes(text)),
  toMatch: (pattern: RegExp) => assert.match(String(value), pattern),
  toBeGreaterThan: (min: number) => assert(Number(value) > min),
  rejects: {
    toThrow: async (message?: string) => {
      if (message) {
        await assert.rejects(
          Promise.resolve(value),
          new RegExp(message),
        );
      } else await assert.rejects(Promise.resolve(value));
    },
  },
});
import { anchoredDate } from "../sales-collections/contract.ts";
import {
  prepareCommercialPresentation,
  renderCommercialPresentation,
} from "./commercial-presentation.ts";
const id = (n: number) =>
  `${n.toString().padStart(8, "0")}-0000-4000-8000-000000000001`;
const fixture = () => ({
  schema_version: 1,
  source: {
    tenant_id: id(1),
    client_id: id(2),
    offer_id: id(3),
    agreement_id: id(4),
    agreement_version: 1,
    agreement_updated_at: "2026-10-01T00:00:00Z",
    body_source: "paige_draft",
    status: "draft",
    content_sha256: null,
    terms_id: id(5),
    terms_version: 3,
    terms_updated_at: "2026-10-01T00:00:00Z",
    invoice_id: id(6),
    invoice_version: 2,
    invoice_draft_version: 3,
    invoice_updated_at: "2026-10-01T00:00:00Z",
  },
  title: "Service agreement",
  body_markdown: "Approved scope text.",
  principal_minor: 350000,
  currency: "usd",
  collection_terms: {
    schema_version: 1,
    kind: "custom",
    currency: "usd",
    total_cents: 350000,
    anchor_date: "2026-11-01",
    cadence: "custom",
    count: 2,
    end_date: null,
    dates: [{ due_date: "2026-11-01", amount_cents: 50000, label: "Deposit" }, {
      due_date: "2026-12-01",
      amount_cents: 300000,
      label: "Balance",
    }],
    deposit_cents: null,
    late_fee: {
      fixed_cents: 0,
      rate_bps: 0,
      grace_days: 0,
      agreement_basis: null,
    },
    interest: { annual_bps: 0, agreement_basis: null },
  },
  conditions: {
    schema_version: 1,
    tax: {
      state: "not_applicable",
      charges: [],
      source: "Owner recorded decision",
      policy: "No tax applicable",
    },
    fees: {
      state: "not_applicable",
      charges: [],
      source: "Owner recorded decision",
      policy: "No fees applicable",
    },
  },
  lines: [{ unit_minor: 350000, quantity: 1 }],
});
describe("prospective commercial presentation preparation only", () => {
  it("binds full exact dated rows and explicit conditions to deterministic payload", async () => {
    const x = fixture();
    const a = await prepareCommercialPresentation(x);
    const b = await prepareCommercialPresentation(x);
    expect(a).toEqual(b);
    expect(a.payload.obligations).toHaveLength(2);
    expect(a.appendix).toContain("2026-11-01 - USD 500.00");
    expect(a.appendix).toContain("2026-12-01 - USD 3,000.00");
    expect(a.payload_digest).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.isFrozen(a.payload)).toBe(true);
    expect(Object.isFrozen(a.payload.obligations)).toBe(true);
  });
  it("passes complete appendix to incumbent renderer after original source equality", async () => {
    const x = fixture(), expected = await prepareCommercialPresentation(x);
    let input;
    const out = await renderCommercialPresentation(
      x,
      expected,
      async (value) => {
        input = value;
        return new Uint8Array([1, 2, 3]);
      },
    );
    expect(input).toEqual({
      title: x.title,
      bodyMarkdown: `${x.body_markdown}\n\n${expected.appendix}`,
    });
    expect(out.document_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(out.payload_digest).toBe(expected.payload_digest);
  });
  for (
    const key of [
      "terms_version",
      "agreement_version",
      "invoice_version",
      "invoice_draft_version",
      "invoice_updated_at",
      "client_id",
    ]
  ) {
    it(`refuses changed source ${key} against original expectation`, async () => {
      const x = fixture(), a = await prepareCommercialPresentation(x);
      const altered = structuredClone(x);
      Object.assign(altered.source, {
        [key]: key === "client_id"
          ? id(9)
          : key === "invoice_updated_at"
          ? "2026-10-02T00:00:00Z"
          : 99,
      });
      let called = false;
      await expect(renderCommercialPresentation(altered, a, async () => {
        called = true;
        return new Uint8Array();
      })).rejects.toThrow("COMMERCIAL_PRESENTATION_CHANGED");
      expect(called).toBe(false);
    });
  }
  it("refuses amount/body/schedule drift without blessing a newly generated digest", async () => {
    const x = fixture(), a = await prepareCommercialPresentation(x);
    x.body_markdown = "Different scope";
    await expect(renderCommercialPresentation(x, a)).rejects.toThrow(
      "COMMERCIAL_PRESENTATION_CHANGED",
    );
  });
  for (
    const mode of [
      "unknown",
      "missing",
      "upload",
      "frozen",
      "unbounded",
      "missing_fee",
    ]
  ) {
    it(`refuses unsupported or unrecorded facts ${mode}`, async () => {
      const x = fixture();
      if (mode === "unknown") {
        Object.assign(x.conditions.tax, {
          state: "unknown",
          charges: [],
          source: null,
          policy: null,
        });
      }
      if (mode === "missing") Reflect.deleteProperty(x, "conditions");
      if (mode === "upload") x.source.body_source = "tenant_upload";
      if (mode === "frozen") {
        Object.assign(x.source, { content_sha256: "a".repeat(64) });
      }
      if (mode === "unbounded") {
        x.collection_terms.kind = "recurring";
        Object.assign(x.collection_terms, { count: null });
        x.collection_terms.dates = [];
        x.collection_terms.cadence = "monthly";
      }
      if (mode === "missing_fee") {
        Reflect.deleteProperty(x.collection_terms, "late_fee");
      }
      await expect(prepareCommercialPresentation(x)).rejects.toThrow();
    });
  }
  it("uses canonical condition line bounds instead of accepting extra tax debt", async () => {
    const x = fixture();
    Object.assign(x.conditions.tax, {
      state: "recorded",
      charges: [{ line_index: 0, amount_minor: 350001, currency: "usd" }],
      source: "Recorded tax",
      policy: "Included tax",
    });
    await expect(prepareCommercialPresentation(x)).rejects.toThrow();
  });
});

it("renders a real PDF through the incumbent renderer with the complete appendix", async () => {
  const x = fixture(), prepared = await prepareCommercialPresentation(x);
  const result = await renderCommercialPresentation(x, prepared);
  expect(new TextDecoder().decode(result.document_bytes.slice(0, 5))).toBe(
    "%PDF-",
  );
  expect(result.document_bytes.length).toBeGreaterThan(1000);
  expect((await PDFDocument.load(result.document_bytes)).getPageCount())
    .toBeGreaterThan(0);
  expect(result.document_sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(result.payload.obligations).toHaveLength(2);
});

it("includes more than the old 24-row preview without truncation", async () => {
  const x = fixture();
  Object.assign(x.collection_terms, {
    kind: "installment",
    cadence: "monthly",
    count: 30,
    dates: [],
  });
  const prepared = await prepareCommercialPresentation(x);
  expect(prepared.payload.obligations).toHaveLength(30);
  expect(prepared.appendix).toContain(anchoredDate("2026-11-01", 29, 1));
  const result = await renderCommercialPresentation(x, prepared);
  expect((await PDFDocument.load(result.document_bytes)).getPageCount())
    .toBeGreaterThan(1);
});
it("captures original body before asynchronous digest work so later caller mutation cannot change rendered bytes", async () => {
  const x = fixture(), expected = await prepareCommercialPresentation(x);
  let body = "";
  const run = renderCommercialPresentation(x, expected, async (input) => {
    body = input.bodyMarkdown;
    return new Uint8Array([1]);
  });
  x.body_markdown = "Mutated while hashing";
  await run;
  expect(body).toContain("Approved scope text.");
  assert(!body.includes("Mutated while hashing"));
});
it("refuses economic schedule drift against original source digest", async () => {
  const x = fixture(), expected = await prepareCommercialPresentation(x);
  x.collection_terms.dates[0].amount_cents = 60000;
  x.collection_terms.dates[1].amount_cents = 290000;
  await expect(renderCommercialPresentation(x, expected)).rejects.toThrow(
    "COMMERCIAL_PRESENTATION_CHANGED",
  );
});
it("refuses incomplete charge declaration and mismatched principal/currency", async () => {
  for (
    const mutate of [(x: ReturnType<typeof fixture>) => {
      Reflect.deleteProperty(x.collection_terms.interest, "annual_bps");
    }, (x: ReturnType<typeof fixture>) => {
      x.principal_minor = 350001;
    }, (x: ReturnType<typeof fixture>) => {
      x.collection_terms.currency = "eur";
    }]
  ) {
    const x = fixture();
    mutate(x);
    await expect(prepareCommercialPresentation(x)).rejects.toThrow();
  }
});

it("refuses a finite-count recurring contract in this finite principal slice", async () => {
  const x = fixture();
  Object.assign(x.collection_terms, {
    kind: "recurring",
    cadence: "monthly",
    count: 2,
    dates: [],
  });
  await expect(prepareCommercialPresentation(x)).rejects.toThrow();
});
it("presents exact human amounts and dates without internal proof fields", async () => {
  const prepared = await prepareCommercialPresentation(fixture());
  expect(prepared.appendix).toContain("Commercial terms");
  expect(prepared.appendix).toContain("USD 3,500.00");
  expect(prepared.appendix).toContain("2026-11-01");
  expect(prepared.appendix).toContain("USD 500.00");
  expect(prepared.appendix).toContain("USD 3,000.00");
  for (
    const internal of [
      "schema_version",
      "line_index",
      "minor units",
      "SHA-256",
      "terms_id",
      "0%",
      fixture().source.agreement_id,
    ]
  ) assert(!prepared.appendix.includes(internal));
});
it("returns the exact presented Markdown and digest from the same renderer input", async () => {
  const x = fixture(), prepared = await prepareCommercialPresentation(x);
  let seen = "";
  const result = await renderCommercialPresentation(
    x,
    prepared,
    async (input) => {
      seen = input.bodyMarkdown;
      return new Uint8Array([1]);
    },
  );
  expect(result.presented_body_markdown).toBe(seen);
  expect(result.presented_body_sha256).toBe(await sha256Hex(seen));
  expect(x.body_markdown).toBe("Approved scope text.");
});

it("describes recorded included tax without raw line indexes or additional obligations", async () => {
  const x = fixture();
  Object.assign(x.conditions.tax, {
    state: "recorded",
    charges: [{ line_index: 0, amount_minor: 2500, currency: "usd" }],
    source: "Recorded invoice tax",
    policy: "Included sales tax",
  });
  const p = await prepareCommercialPresentation(x);
  expect(p.appendix).toContain("USD 25.00 included in invoice item 1.");
  expect(p.appendix).toContain("They do not add amounts");
  expect(p.payload.obligations).toHaveLength(2);
  expect(p.payload.principal_minor).toBe(350000);
  assert(!p.appendix.includes("line_index"));
});
