import { useSubtabRoute } from "@/lib/routing/useSubtabRoute";
import { OperationsWorkspace } from "./OperationsWorkspace";

/** Mounted only by the canonical Solo route after shared navigation integration. */
export function OperationsRoute({ openPaige }: { openPaige: () => void }) {
  const [view, setView] = useSubtabRoute("solo", "operations", "overview");
  return <OperationsWorkspace openPaige={openPaige} view={view} onViewChange={setView} />;
}
