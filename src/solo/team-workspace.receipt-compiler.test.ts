import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// Compile the actual parent callback: runtime transpilation cannot catch a receipt
// union losing its narrowing inside a React state updater.
const source = readFileSync(resolve("src/solo/team-workspace.tsx"), "utf8");
const savedType = source.match(/^type TeamEditorSaved = .+;$/m)?.[0];
const handler = source.match(/ {2}const handleSaved = \(saved\?: TeamEditorSaved\) => \{[\s\S]*?\n {2}\};/)?.[0];
if (!savedType || !handler) throw new Error("Original Team receipt handler missing");
const fixture = `
  type TeamPermissionReceipt = { membership_id: string; permission: "admin" | "member" };
  ${savedType}
  type SelectedMember = { membership_id: string; job_title: string; responsibilities: string; permission: string };
  declare function setSelected(update: (current: SelectedMember | null) => SelectedMember | null): void;
  declare const team: { refresh(): Promise<void> };
  ${handler}
`;

describe("original Team saved receipt callback compiler", () => {
  it.each([false, true])("preserves the closed receipt variants with strict=%s", (strict) => {
    const filename = resolve("team-receipt-compiler-fixture.ts");
    const options: ts.CompilerOptions = { noEmit: true, strict, skipLibCheck: true, types: [], target: ts.ScriptTarget.ES2020 };
    const host = ts.createCompilerHost(options);
    const original = host.getSourceFile.bind(host);
    host.getSourceFile = (path, languageVersion, onError, shouldCreateNewSourceFile) => resolve(path) === filename
      ? ts.createSourceFile(path, fixture, languageVersion, true)
      : original(path, languageVersion, onError, shouldCreateNewSourceFile);
    const program = ts.createProgram([filename], options, host);
    const errors = ts.getPreEmitDiagnostics(program).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
    expect(errors.map((diagnostic) => `${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`)).toEqual([]);
  });
});
