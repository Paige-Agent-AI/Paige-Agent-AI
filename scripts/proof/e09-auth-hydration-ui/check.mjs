import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "playwright";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const output = path.resolve(root, process.argv[2] ?? ".impeccable/review/e09-auth-hydration");
await fs.mkdir(output, { recursive: true });
const adapter = path.join(root, "scripts/proof/e09-auth-hydration-ui/adapter.tsx");
const fixturePaths = ["integrations/supabase/client", "lib/playbook", "lib/auth/signOut", "lib/auth/resolveLandingRoute", "lib/onboardingOffer", "lib/scopedUser", "contexts/DashboardModeContext", "contexts/ImpersonationContext", "hooks/useCreditFactors", "hooks/useTenantFeature", "hooks/useSessionTimeout", "hooks/usePresenceHeartbeat", "hooks/useAnalytics", "hooks/useUnreadSupportCount", "components/app/PaigeChat", "components/app/QuickStatsBar", "components/admin/AdminViewBanner", "components/auth/SessionTimeoutWarning", "components/dashboard/OnboardingChecklist", "components/dashboard/OnboardingFlow", "components/notifications/PushNotificationPrompt", "components/legal/RequiredConsentsGate", "components/client/ClientHomeTiles", "components/app/ClientActivityFeed", "components/planning/UpcomingWidget", "components/dashboard/NotificationBell", "components/ui/avatar-uploader"];
const bundle = await build({ entryPoints: [path.join(root, "scripts/proof/e09-auth-hydration-ui/source.tsx")], bundle: true, write: false, format: "iife", jsx: "automatic", loader: { ".css": "empty" }, define: { "process.env.NODE_ENV": '"production"', "import.meta.env.DEV": "false" }, plugins: [{ name: "local-source-auth-doubles", setup(api) {
  api.onResolve({ filter: /^@\// }, args => fixturePaths.includes(args.path.slice(2)) ? { path: adapter } : undefined);
  api.onResolve({ filter: /^@tanstack\/react-query$/ }, () => ({ path: adapter }));
} }] });
const assets = path.join(root, "dist/assets"), styles = (await fs.readdir(assets)).filter(file => file.endsWith(".css"));
let css = (await Promise.all(styles.map(file => fs.readFile(path.join(assets, file), "utf8")))).join("\n");
for (const match of [...css.matchAll(/url\(([^)]*\.woff2)\)/g)]) {
  const url = match[1].replace(/["']/g, "");
  if (url.startsWith("/assets/")) css = css.replaceAll(match[0], `url(data:font/woff2;base64,${(await fs.readFile(path.join(root, "dist", url.slice(1)))).toString("base64")})`);
}
const options = { headless: true };
try { await fs.access(chromium.executablePath()); } catch { options.executablePath = "C:/Program Files/Google/Chrome/Application/chrome.exe"; }
const browser = await chromium.launch(options), errors = [], captures = [];
try {
  for (const [width, height] of [[1536,770], [390,844]]) {
    for (const staff of [false, true]) {
      const page = await browser.newPage({ viewport: { width, height }, reducedMotion: "reduce" });
      page.on("pageerror", error => errors.push(error.message));
      await page.route("**/*", route => route.abort());
      await page.setContent('<html class="light" data-pg="light"><head></head><body><div id="root"></div></body></html>');
      await page.addStyleTag({ content: css }); await page.addScriptTag({ content: bundle.outputFiles[0].text });
      const capture = async state => {
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
        assert.equal(overflow, false, "unchanged parent must fit");
        const file = `${width}-${height}-${state}.png`; await page.screenshot({ path: path.join(output,file), fullPage: true }); captures.push({ file, width, height, state, overflow });
      };
      await page.getByText("Loading...", { exact: true }).waitFor();
      if (staff) {
        await page.evaluate(() => { window.authHydrationProof.staff(); window.authHydrationProof.newer(); });
        await page.getByRole("status").filter({ hasText: "Staff destination" }).waitFor();
        await page.evaluate(() => window.authHydrationProof.staleEmpty());
        await page.waitForTimeout(60); assert.match(await page.getByRole("status").innerText(), /Staff destination/);
        await capture("staff-after-retired-null");
      } else {
        await capture("initial-loading");
        await page.evaluate(() => window.authHydrationProof.newer());
        await page.getByText("Test Service Studio", { exact: true }).waitFor();
        await page.evaluate(() => document.fonts.ready);
        assert.equal(await page.getByTestId("paige-fixture").getAttribute("data-actor"),"test-actor-b");
        await capture("newer-event");
        await page.evaluate(() => window.authHydrationProof.stale());
        await page.waitForTimeout(60);
        assert.equal(await page.getByTestId("paige-fixture").getAttribute("data-actor"),"test-actor-b");
        await capture("after-stale-initial");
        await page.evaluate(() => window.authHydrationProof.signOut());
        await page.getByRole("status").filter({ hasText: "Sign-in destination" }).waitFor();
        assert.equal(await page.getByTestId("paige-fixture").count(),0);
        await capture("signed-out");
      }
      await page.close();
    }
  }
  assert.deepEqual(errors,[]);
  const files = ["src/pages/AppShell.tsx", "src/pages/AppShell.client-refresh.test.tsx", "src/components/app/AppNav.tsx", "src/hooks/useClientPortalRead.ts", "src/hooks/useClientPortalBrand.ts", "src/hooks/useClientPortalConfig.ts"];
  const sources = await Promise.all(files.map(async file => ({ file, sha256: createHash("sha256").update(await fs.readFile(path.join(root,file))).digest("hex") })));
  await fs.writeFile(path.join(output,"result.json"),JSON.stringify({ evidenceClass:"isolated-actual-source-parent-auth-transitions",auth:"synthetic SDK, not external customer acceptance",network:"all blocked; in-memory documents only, no URL navigation",native:"AppShell/AppNav/brand-config hooks/router/resizer/UI; SDK, PAIGE/domain/context/consent/notification leaves explicit test doubles",sources,captures,errors },null,2));
  const review = path.join(root,".impeccable/review"); await fs.mkdir(review,{recursive:true});
  await fs.copyFile(path.join(output,"1536-770-after-stale-initial.png"),path.join(review,"desktop.png"));
  await fs.copyFile(path.join(output,"390-844-after-stale-initial.png"),path.join(review,"mobile.png"));
  console.log(JSON.stringify({ captures:captures.length,errors:errors.length,output }));
} finally { await browser.close(); }
