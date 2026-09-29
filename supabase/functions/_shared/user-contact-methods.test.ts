// Executed proof for the address read used by ingest-rag-outcome, security-canary-probe and
// send-funding-report, and for the anonymizer consuming it. Runs under Deno in CI (ci.yml).
import { assertEquals, assertRejects, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  ContactMethodsReadError,
  contactMethodsForUser,
  primaryEmailForUser,
  primaryEmailsForUsers,
} from "./user-contact-methods.ts";
import { anonymize } from "./rag-anonymize.ts";

type Row = { user_id: string; kind: "email" | "phone"; value: string; is_primary: boolean; position: number };

// A stand-in for the supabase-js query builder that applies the filters the helper sends, so a
// wrong column or a dropped filter changes the answer. Records the table and columns requested.
function fakeDb(rows: Row[], opts: { error?: { message: string } } = {}) {
  const calls: { table: string; select: string }[] = [];
  return {
    calls,
    from(table: string) {
      let out = rows.slice();
      const q: any = {
        select(cols: string) { calls.push({ table, select: cols }); return q; },
        eq(col: keyof Row, v: unknown) { out = out.filter((r) => r[col] === v); return q; },
        in(col: keyof Row, vs: unknown[]) { out = out.filter((r) => vs.includes(r[col])); return q; },
        then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) {
          return Promise.resolve(opts.error ? { data: null, error: opts.error } : { data: out, error: null }).then(res, rej);
        },
      };
      return q;
    },
  };
}

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const C = "00000000-0000-4000-8000-00000000000c";
const rows: Row[] = [
// The non-primary email comes LAST so a dropped primary filter would return it.
  { user_id: A, kind: "email", value: "a@x.test", is_primary: true, position: 0 },
  { user_id: A, kind: "email", value: "a.second@x.test", is_primary: false, position: 1 },
  { user_id: A, kind: "phone", value: "555.0101 ext 9", is_primary: true, position: 0 },
  { user_id: B, kind: "email", value: "b@x.test", is_primary: true, position: 0 },
];

Deno.test("primaryEmailsForUsers reads user_contact_methods, never profiles", async () => {
  const db = fakeDb(rows);
  await primaryEmailsForUsers(db, [A]);
  assertEquals(db.calls, [{ table: "user_contact_methods", select: "user_id, value" }]);
});

Deno.test("each user maps to their own primary email; a user without one is absent", async () => {
  const got = await primaryEmailsForUsers(fakeDb(rows), [A, B, C, A]);
  assertEquals([...got.entries()].sort(), [[A, "a@x.test"], [B, "b@x.test"]]);
});

Deno.test("no ids is no query and an empty answer", async () => {
  const db = fakeDb(rows);
  assertEquals((await primaryEmailsForUsers(db, [])).size, 0);
  assertEquals(db.calls.length, 0);
});

Deno.test("primaryEmailForUser returns the primary, or null", async () => {
  assertEquals(await primaryEmailForUser(fakeDb(rows), A), "a@x.test");
  assertEquals(await primaryEmailForUser(fakeDb(rows), C), null);
});

Deno.test("a failed read throws instead of looking like 'no address'", async () => {
  const broken = fakeDb(rows, { error: { message: 'column "email" does not exist' } });
  await assertRejects(() => primaryEmailsForUsers(broken, [A]), ContactMethodsReadError, "does not exist");
  await assertRejects(() => contactMethodsForUser(broken, A), ContactMethodsReadError);
});

Deno.test("contactMethodsForUser returns every address, primary first", async () => {
  assertEquals(await contactMethodsForUser(fakeDb(rows), A), {
    emails: ["a@x.test", "a.second@x.test"],
    phones: ["555.0101 ext 9"],
  });
});

Deno.test("the anonymizer scrubs every address the person holds, including a non-standard one", async () => {
  const methods = await contactMethodsForUser(fakeDb(rows), A);
  const out = anonymize(
    "Reach Ada Lovelace at a@x.test, a.second@x.test or 555.0101 ext 9.",
    { fullName: "Ada Lovelace", emails: methods.emails, phones: methods.phones },
  );
  assert(!out.includes("Ada"), out);
  assert(!out.includes("x.test"), out);
  assert(!out.includes("0101"), out);
});
