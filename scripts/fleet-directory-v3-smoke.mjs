// Fleet Directory v3 lineage and retirement smoke.
//
// The authoritative v3 `fleetVals` builder replaces the retired orbital field
// with a directory, composition bar, internal-account control, and audited
// tenant-entry rows. Component tests exercise rendered states; this independent
// source guard prevents the retired modules or lineage from silently returning.
import { existsSync, readFileSync } from "node:fs";

const surfaceUrl = new URL("../src/operator/surfaces/FleetConsole.tsx", import.meta.url);
const retiredUrls = [
  new URL("../src/operator/surfaces/FleetOrbit.tsx", import.meta.url),
  new URL("../src/operator/surfaces/FleetOrbitScene.tsx", import.meta.url),
  new URL("../src/operator/surfaces/FleetTenantsRail.tsx", import.meta.url),
];

let failures = 0;
const fail = (message) => {
  console.error(`x ${message}`);
  failures += 1;
};
const ok = (message) => console.log(`ok ${message}`);
const source = readFileSync(surfaceUrl, "utf8");

for (const retiredUrl of retiredUrls) {
  if (existsSync(retiredUrl)) fail(`${retiredUrl.pathname.split("/").at(-1)} still exists`);
}
if (failures === 0) ok("retired orbit and tenant-rail modules are absent");

const forbidden = ["FleetOrbit", "FleetOrbitScene", "FleetTenantsRail", "SC_FLEET"];
for (const token of forbidden) {
  if (source.includes(token)) fail(`FleetConsole still references retired token ${token}`);
}
if (!forbidden.some((token) => source.includes(token))) ok("FleetConsole has no retired surface references");

const required = [
  "PAIGE Super Admin Shell v3.dc.html",
  "builder `fleetVals` 8269–8362",
  'aria-label="Fleet composition"',
  'aria-pressed={showInternal}',
  "enterOperatorActAs(tenant.id)",
];
for (const token of required) {
  if (!source.includes(token)) fail(`FleetConsole is missing v3 guard token: ${token}`);
}
if (required.every((token) => source.includes(token))) {
  ok("v3 lineage, composition, internal control, and audited entry seam are present");
}

if (failures > 0) {
  console.error(`\n${failures} Fleet Directory v3 smoke failure(s).`);
  process.exit(1);
}

console.log("\nFleet Directory v3 smoke: clean.");
