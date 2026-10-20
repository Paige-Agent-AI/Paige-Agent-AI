// Client portal — the sections your clients see in their portal, in order.
// Extracted verbatim from PlaybookAdmin.
//
// E09 Slice M: renaming an existing module keeps its key (a key is what routes the entry; re-slugging it on
// every keystroke turned "Sessions" into an unrouted "appointments" that vanished from the portal). Only a
// module added here, whose key is still empty, takes its key from its first name. The customer menu's own
// names, order and visibility live in Clients → Portal (PortalStudio's "Customer portal menu").
import { useState } from "react";
import { Link, useInRouterContext, useLocation } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Plus } from "lucide-react";
import { RowShell, SectionIntro, slugify, type SectionProps } from "./shared";

const MENU_POINTER = "Names, order and visibility of your customers' menu are set in Clients → Portal.";

/** In Solo the pointer links to the account's Clients → Portal; elsewhere the route differs by shell. */
function MenuPointer() {
  return useInRouterContext() ? <RoutedMenuPointer /> : <p className="text-xs text-muted-foreground">{MENU_POINTER}</p>;
}
function RoutedMenuPointer() {
  const solo = /^\/solo\/([^/]+)(?:\/|$)/.exec(useLocation().pathname);
  if (!solo) return <p className="text-xs text-muted-foreground">{MENU_POINTER}</p>;
  return (
    <p className="text-xs text-muted-foreground">
      Names, order and visibility of your customers' menu are set in{" "}
      <Link to={`/solo/${solo[1]}/clients/portal`} className="font-medium text-foreground underline underline-offset-2">Clients → Portal</Link>.
    </p>
  );
}

export function PortalSection({ pb, patch }: SectionProps) {
  // Rows added in this editor whose key is still being named. Keyed by the row object's position.
  const [fresh, setFresh] = useState<ReadonlySet<number>>(() => new Set());
  return (
    <div className="space-y-4">
      <SectionIntro>The sections your clients see in their portal, in order.</SectionIntro>
      <Card>
        <CardContent className="space-y-2 pt-6">
          {pb.portal.modules.map((m, i) => (
            <RowShell key={i} onRemove={() => {
              patch((d) => { d.portal.modules.splice(i, 1); });
              setFresh((prev) => new Set([...prev].filter((j) => j !== i).map((j) => (j > i ? j - 1 : j))));
            }}>
              <Input aria-label="Portal module name" value={m.label} placeholder="Module name" onChange={(e) => {
                const label = e.target.value;
                const naming = fresh.has(i) || !m.key;
                patch((d) => { d.portal.modules[i].label = label; if (naming) d.portal.modules[i].key = slugify(label); });
                if (naming && !fresh.has(i)) setFresh((prev) => new Set(prev).add(i));
              }} />
            </RowShell>
          ))}
          <Button variant="outline" size="sm" onClick={() => {
            const index = pb.portal.modules.length;
            patch((d) => { d.portal.modules.push({ key: "", label: "" }); });
            setFresh((prev) => new Set(prev).add(index));
          }}>
            <Plus className="w-4 h-4 mr-1" /> Add module
          </Button>
        </CardContent>
      </Card>
      <MenuPointer />
    </div>
  );
}
