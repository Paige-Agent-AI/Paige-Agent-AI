import {mergeConfig} from "vitest/config";
import original from "../../vitest.config";

// Causal regression control: restore the prior history reset in the loaded
// module only. The actual application source and normal test configuration
// remain unchanged. The two continuity cases must fail under this control.
export default mergeConfig(original, {plugins: [{
  name: "e09-original-host-reset-negative-control",
  enforce: "pre",
  transform(source: string, id: string) {
    if (!id.replaceAll("\\", "/").endsWith("/src/components/app/PaigeChat.tsx")) return;
    const boundary = '    setHistoryState("loading");';
    if (source.split(boundary).length !== 2) throw Error("Original history boundary changed");
    return source.replace(boundary, boundary + '\n    setCustomerThread(null);');
  },
}]});
