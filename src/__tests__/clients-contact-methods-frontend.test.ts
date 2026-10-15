// A contact's emails and phones live in `client_contact_methods`; a person's in
// `user_contact_methods` (20270515000000). `clients.email` / `clients.phone` and
// `profiles.work_email` / `profiles.phone` are a read-only mirror of the primaries that a later
// migration DROPS. These prove the frontend no longer reads, filters or writes those four columns,
// so the drop breaks nothing here, and that the inbox still hands its consumers `email` / `phone`
// — now the PRIMARY addresses — under the same field names (§37).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MESSAGE_COLS, THREAD_COLS, messageRowsFromDb, threadsFromDb } from "@/pages/admin/conversations/inbox-shared";

const ROOT = join(__dirname, "..", "..");

// Every frontend source file that touches the `clients` or `profiles` table, found by scanning
// `src/` rather than kept as a hand-written list: a list goes stale the moment a file is renamed
// or added (the 2026-09-28 list kept guarding `useSoloAgreements.ts` after its live successor,
// `useSoloCommercialTerms.ts`, took over).
const TABLE_TOUCH = /\.from\(\s*["'](clients|profiles)["']|["'`][^"'`\n]*\bclients(?::\w+)?\(/;

function sourceFiles(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return entry.name === "__tests__" ? [] : sourceFiles(rel);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.(test|spec)\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".d.ts")
      ? [rel]
      : [];
  });
}

const FILES = sourceFiles("src").filter((file) => TABLE_TOUCH.test(readFileSync(join(ROOT, file), "utf8")));

const ADDRESS_COLUMN = /(^|[\s,(])(email|phone|work_email)(\s*(,|\)|$|:))/;

/** Each `.from("clients"|"profiles")` chain in a file: the table, and the source up to the statement's end. */
function chains(source: string) {
  const out: Array<{ table: string; text: string }> = [];
  const re = /\.from\(\s*["'](clients|profiles)["'](?:\s+as\s+\w+)?\s*\)/g;
  for (let m = re.exec(source); m; m = re.exec(source)) {
    const rest = source.slice(m.index);
    const end = rest.search(/;\s*\n|\n\s*\n/);
    out.push({ table: m[1], text: end > 0 ? rest.slice(0, end) : rest.slice(0, 600) });
  }
  return out;
}

/** String literals passed to `.select(`, resolving a same-file `const NAME = "..."` / template. */
function selectStrings(source: string, text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\.select\(\s*(["'`])([\s\S]*?)\1/g)) out.push(m[2]);
  for (const m of text.matchAll(/\.select\(\s*([A-Z_][A-Z0-9_]*)\s*[,)]/g)) {
    const def = new RegExp(`const\\s+${m[1]}(?:\\s*:\\s*string)?\\s*=\\s*([\\s\\S]*?);\\n`).exec(source);
    if (def) out.push(def[1]);
  }
  return out;
}

describe("the frontend is off the old contact address columns", () => {
  it("finds the files it guards, including the live successors of renamed ones", () => {
    expect(FILES).toContain("src/solo/useSoloCommercialTerms.ts");
    expect(FILES).toContain("src/pages/admin/ContactDetail.tsx");
    expect(FILES.length).toBeGreaterThan(30);
  });

  for (const file of FILES) {
    it(`${file} neither reads, filters nor writes clients.email/phone or profiles.work_email/phone`, () => {
      const source = readFileSync(join(ROOT, file), "utf8");
      for (const { table, text } of chains(source)) {
        for (const selected of selectStrings(source, text)) {
          const columns = selected.replace(/\w+\([^)]*\)/g, "");
          const hit = table === "clients" ? /\b(email|phone)\b/.exec(columns) : /\b(work_email|phone)\b/.exec(columns);
          expect(hit, `${file}: .from("${table}").select(...) names "${hit?.[0]}"`).toBeNull();
        }
        const write = /\.(update|insert|upsert)\(\s*\{([\s\S]*?)\}\s*(?:as\s+\w+\s*)?\)/.exec(text);
        if (write) expect(write[2], `${file}: ${table} ${write[1]} writes an address column`).not.toMatch(/(^|[\s,{])(email|phone|work_email)\s*:/);
        expect(text, `${file}: filters ${table} on an address column`).not.toMatch(/\.(eq|neq|ilike|like|in)\(\s*["'](email|phone|work_email)["']/);
        expect(text, `${file}: an .or() filter names an address column`).not.toMatch(/[`"',](email|phone)\.(eq|ilike|like|in)\./);
      }
      // A `clients(...)` embed inside another table's select must not name them either.
      for (const embed of source.matchAll(/["'`][^"'`\n]*\bclients(?::\w+)?\(([^)]*)\)/g)) {
        expect(embed[1].replace(/\w+\([^)]*$/, ""), `${file}: clients embed names an address column`).not.toMatch(ADDRESS_COLUMN);
      }
    });
  }
});

describe("the inbox reads a contact's primary addresses from its methods", () => {
  it("embeds the contact's methods instead of the old columns, in both pulls", () => {
    expect(THREAD_COLS).toContain("client_contact_methods(");
    expect(MESSAGE_COLS).toContain("client_contact_methods(");
    const threadContact = /clients:contact_id\(([\s\S]*)\)$/.exec(THREAD_COLS)?.[1] ?? "";
    expect(threadContact.replace(/client_contact_methods\([^)]*\)/, "")).not.toMatch(/\b(email|phone)\b/);
    expect(MESSAGE_COLS.replace(/client_contact_methods\([^)]*\)/, "")).not.toMatch(/\bclients\([^)]*\b(email|phone)\b/);
  });

  it("hands every consumer `email` / `phone` as the PRIMARY addresses, under the same names", () => {
    const [thread] = threadsFromDb([{
      id: "t1", thread_key: "k", contact_id: "c1", snoozed_until: null, archived_at: null, labels: null, unread_count: 0,
      last_message_at: null, last_direction: null,
      clients: {
        id: "c1", first_name: "Jordan", last_name: "Reyes",
        client_contact_methods: [
          { id: "e2", kind: "email", value: "second@example.test", label: null, is_primary: false, position: 1 },
          { id: "e1", kind: "email", value: "first@example.test", label: null, is_primary: true, position: 0 },
          { id: "p1", kind: "phone", value: "+1 202 555 0142", label: null, is_primary: true, position: 0 },
        ],
      },
    }]);
    expect(thread.clients?.email).toBe("first@example.test");
    expect(thread.clients?.phone).toBe("+1 202 555 0142");
    expect(thread.clients).not.toHaveProperty("client_contact_methods");

    const [noAddress, unlinked] = threadsFromDb([
      { id: "t2", clients: { id: "c2", first_name: "A", client_contact_methods: [] } },
      { id: "t3", clients: null },
    ]);
    expect([noAddress.clients?.email, noAddress.clients?.phone]).toEqual([null, null]);
    expect(unlinked.clients).toBeNull();

    const [message] = messageRowsFromDb([{ id: "m1", clients: { first_name: "Jordan", last_name: null, entity_name: null, client_contact_methods: [{ id: "e1", kind: "email", value: "first@example.test", label: null, is_primary: true, position: 0 }] } }]);
    expect(message.clients).toEqual({ first_name: "Jordan", last_name: null, entity_name: null, email: "first@example.test" });
    expect(messageRowsFromDb(null)).toEqual([]);
  });
});
