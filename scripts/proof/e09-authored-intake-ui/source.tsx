import { useState } from "react";
import { createRoot } from "react-dom/client";
import { usePlaybookEditor } from "@/components/paige/usePlaybookEditor";
import { IntakeSection } from "@/components/paige/sections/IntakeSection";
import { PaigeConsoleSaveBar } from "@/components/paige/PaigeConsoleSaveBar";
function ActualEditor() {
  const editor = usePlaybookEditor("test-tenant-intake");
  return editor.loading || !editor.pb ? <p>Loading fixture</p> : <>
    <PaigeConsoleSaveBar tone="surface" dirty={editor.dirty} saving={editor.saving} justSaved={editor.justSaved} onSave={editor.save} />
    <section data-actual-source><IntakeSection pb={editor.pb} patch={editor.patch} /></section>
  </>;
}
function FixtureHost() {
  const [epoch, setEpoch] = useState(0);
  (window as unknown as { reopenIntakeFixture: () => void }).reopenIntakeFixture = () => setEpoch(value => value + 1);
  // Test host only; actual product shell/PAIGE/provider session are intentionally absent.
  return <main style={{ maxWidth: 760, padding: 24 }}><ActualEditor key={epoch} /></main>;
}
createRoot(document.getElementById("root")!).render(<FixtureHost />);
