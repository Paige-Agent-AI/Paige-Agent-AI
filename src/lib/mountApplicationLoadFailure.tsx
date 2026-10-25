import {createRoot, type Root} from "react-dom/client";
import {PageLoadFailure} from "@/components/app/PageLoadBoundary";

/** Entry recovery has no dependency on the main application or its Auth graph. */
export function mountApplicationLoadFailure(): Root | null {
  const host = document.getElementById("root");
  if (!host) return null;
  window.dispatchEvent(new Event("paige:boot-splash-unmount"));
  document.getElementById("paige-splash")?.remove();
  const root = createRoot(host);
  root.render(<PageLoadFailure />);
  return root;
}
