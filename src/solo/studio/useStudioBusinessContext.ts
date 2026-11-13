import React from "react";
import { readStudioBusinessSources } from "./studio-data";
import { projectStudioBusinessContext, type StudioBusinessContext, type StudioContextTarget } from "./business-context";

export function useStudioBusinessContext(tenantId: string, tenantSlug: string, target: StudioContextTarget | undefined, values: StudioBusinessContext["projectValues"]) {
  const [sources, setSources] = React.useState<{ tenantId: string; readStatus: "available" | "unavailable"; context: unknown; publicBrand: unknown } | null>(null);
  React.useEffect(() => {
    let current = true;
    void readStudioBusinessSources(tenantId, tenantSlug).then(result => { if (current) setSources({ tenantId, ...result }); })
      .catch(() => { if (current) setSources({ tenantId, readStatus: "unavailable", context: null, publicBrand: undefined }); });
    return () => { current = false; };
  }, [tenantId, tenantSlug]);
  return React.useMemo(() => projectStudioBusinessContext({ expectedTenantId: tenantId, target, projectValues: values,
    readStatus: sources?.tenantId === tenantId ? sources.readStatus : "loading", context: sources?.tenantId === tenantId ? sources.context : null,
    publicBrand: sources?.tenantId === tenantId ? sources.publicBrand : undefined }), [tenantId, target, values, sources]);
}
