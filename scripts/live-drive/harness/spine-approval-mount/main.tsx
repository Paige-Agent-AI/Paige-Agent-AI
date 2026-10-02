/**
 * THE APPROVAL PLATE, RENDERED SO IT CAN BE LOOKED AT.
 *
 * §00 says a design is presented as something the owner can SEE, and `src/operator/CLAUDE.md` says
 * an operator surface is not done until it has been driven. The spine sits behind the operator
 * guard, so `dev-loop /operator` shoots the login screen — which proves the route loads and
 * nothing about how the plate reads.
 *
 * This mounts the REAL `SpineConversation` with a plate turn shaped exactly as `useOperatorChat`
 * builds one, in both genuine themes (§23), so the geometry, the gold budget and the type ramp can
 * be judged on pixels rather than on source.
 *
 * WHAT IT DOES NOT PROVE (§13/§32.c): that the AUTHENTICATED console renders, that a real
 * `paige_confirm` frame arrives from the deployed engine, or that a real approval claims. Those
 * need operator credentials and remain OWED to a session that has them. A harness render is not a
 * live drive and must never be reported as one.
 */
import { createRoot } from "react-dom/client";
import { SpineConversation } from "@/operator/shell/OperatorSpine";
import "@/index.css";

const theme = new URLSearchParams(window.location.search).get("theme") === "light" ? "light" : "dark";
document.documentElement.setAttribute("data-pg", theme);
document.documentElement.classList.toggle("dark", theme === "dark");
document.documentElement.setAttribute("data-theme", theme);

const single = new URLSearchParams(window.location.search).get("count") === "1";

const items = [
  "Move Northwind Partners to Proposal — this changes what the pipeline reports.",
  "Email Dana Reyes the revised scope before Friday.",
];

function Harness() {
  return (
    <div data-pg={theme} style={{ background: "var(--pg-env)", minHeight: "100vh", padding: 24 }}>
      <div style={{ width: 364, maxWidth: "100%", background: "var(--pg-surface)", borderRadius: "var(--pg-r-plate)", overflow: "hidden" }}>
        <SpineConversation
          trust={{ level: 2, tally: [0, 1, 0, 0] }}
          turns={[
            { id: "u", who: "You", mine: true, body: "Move Northwind to proposal and chase Dana." },
            { id: "a", who: "Paige", body: single ? "One change to approve." : "Two changes to approve." },
            {
              id: "c",
              who: single ? "Paige — needs your OK" : `Paige — needs your OK · ${items.length} actions`,
              body: "",
              tone: "gold",
              actItems: single ? items.slice(0, 1) : items,
              act: single ? "Approve" : "Approve all",
              onAct: () => {},
              onDismiss: () => {},
            },
          ]}
        />
      </div>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<Harness />);
