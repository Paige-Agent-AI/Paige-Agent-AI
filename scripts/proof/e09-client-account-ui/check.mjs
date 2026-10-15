import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const output = path.resolve(root, process.argv[2] ?? ".impeccable/review/e09-client-account");
await fs.mkdir(output, { recursive: true });
const adapter = path.join(root, "scripts/proof/e09-client-account-ui/adapter.tsx");
const fixtures = ["integrations/supabase/client", "lib/playbook", "lib/auth/signOut", "lib/auth/resolveLandingRoute", "lib/onboardingOffer", "lib/scopedUser", "contexts/DashboardModeContext", "contexts/ImpersonationContext", "hooks/useCreditFactors", "hooks/useTenantFeature", "hooks/useSessionTimeout", "hooks/usePresenceHeartbeat", "hooks/useAnalytics", "hooks/useUnreadSupportCount", "components/app/PaigeChat", "components/app/QuickStatsBar", "components/admin/AdminViewBanner", "components/auth/SessionTimeoutWarning", "components/dashboard/OnboardingChecklist", "components/dashboard/OnboardingFlow", "components/notifications/PushNotificationPrompt", "components/legal/RequiredConsentsGate", "components/client/ClientHomeTiles", "components/app/ClientActivityFeed", "components/planning/UpcomingWidget", "components/dashboard/NotificationBell", "components/ui/avatar-uploader"];
const bundle = await build({ entryPoints: [path.join(root, "scripts/proof/e09-client-account-ui/source.tsx")], bundle: true, write: false, format: "iife", jsx: "automatic", loader: { ".css": "empty" }, define: { "process.env.NODE_ENV": '"production"', "import.meta.env.DEV": "false" }, plugins: [{ name: "explicit-account-source-doubles", setup(api) {
  api.onResolve({ filter: /^@\// }, args => fixtures.includes(args.path.slice(2)) ? { path: adapter } : undefined);
  api.onResolve({ filter: /^@tanstack\/react-query$/ }, () => ({ path: adapter }));
} }] });
// src/main.tsx imports index.css. Other lazy departmental styles do not belong to this fixture.
const styles = (await fs.readdir(path.join(root,"dist/assets"))).filter(f=>/^main-.*\.css$/.test(f));
assert.equal(styles.length,1,"the compiled application stylesheet is required");
let css = await fs.readFile(path.join(root,"dist/assets",styles[0]),"utf8");
for (const match of [...css.matchAll(/url\(([^)]*\.woff2)\)/g)]) {
  const url = match[1].replace(/["']/g, "");
  if (url.startsWith("/assets/")) css = css.replaceAll(match[0], `url(data:font/woff2;base64,${(await fs.readFile(path.join(root, "dist", url.slice(1)))).toString("base64")})`);
}
const options = { headless: true }; try { await fs.access(chromium.executablePath()); } catch { options.executablePath = "C:/Program Files/Google/Chrome/Application/chrome.exe"; }
const browser = await chromium.launch(options), errors = [], cases = [];
try {
  for (const [width, height, state, context, theme] of [
    [1536,770,"ready","a","light"], [1366,768,"ready","b","light"], [1024,768,"ready","b","light"], [900,1000,"ready","a","light"], [390,844,"ready","a","light"],
    [1536,770,"ready","b","dark"], [390,844,"ready","b","dark"], [320,720,"ready","a","light"],
    [390,844,"loading","a","light"], [390,844,"unavailable","a","light"], [390,844,"read-error","a","light"],
  ]) {
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: "reduce" });
    page.on("pageerror", error => errors.push(error.message)); await page.route("**/*", route => route.abort());
    await page.setContent(`<html class="${theme === "dark" ? "dark" : "light"}" data-pg="${theme}"><head></head><body><div id="root"></div></body></html>`);
    await page.addStyleTag({ content: css }); await page.evaluate(seed => { window.accountSeed = seed; }, { context, state });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.getByRole("heading", { name: "Your account", exact: true }).waitFor(); await page.evaluate(() => document.fonts.ready);
    if (state === "ready") await page.getByLabel("First name", { exact: true }).waitFor();
    else await page.getByText(state === "loading" ? "Loading your information…" : state === "unavailable" ? "Your information is unavailable for this business. Contact the business if you need access." : "Your information could not be loaded. Check your connection and try again.", { exact: true }).waitFor();
    const capture = async suffix => {
      const geometry = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth,
        formWidth: document.querySelector("form")?.getBoundingClientRect().width ?? null,
        inputSizes: [...document.querySelectorAll("form input")].map(e => ({ height: e.getBoundingClientRect().height, font: getComputedStyle(e).fontSize })),
        controls: [...document.querySelectorAll("section[aria-labelledby='client-account-title'] button,section[aria-labelledby='client-account-title'] a")].map(e => ({ text:e.textContent, height:e.getBoundingClientRect().height })),
        reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
        scrollOwner: document.querySelector("section[aria-labelledby='client-account-title']")?.parentElement?.getAttribute("class") }));
      assert.equal(geometry.overflow, false);
      assert(geometry.inputSizes.every(e => e.height >= 44 && parseFloat(e.font) >= 16), "actual form inputs must be at least 44px high and 16px text");
      assert(geometry.controls.every(e => e.height >= 44), "actual form controls must be at least 44px high");
      assert.equal(geometry.reducedMotion,true);
      const file = `${width}-${height}-${theme}-${context}-${state}-${suffix}.png`;
      await page.screenshot({ path: path.join(output,file), fullPage: true }); cases.push({ file, width, height, theme, context, state, suffix, geometry });
    };
    await capture("initial");
    if (state === "ready" && width === 320) {
      const last = page.getByRole("button",{name:"Save information",exact:true});
      await last.scrollIntoViewIfNeeded();
      const reachability = await last.evaluate(e=>{const r=e.getBoundingClientRect();return { top:r.top,bottom:r.bottom,height:innerHeight,scrollTop:e.closest("section")?.parentElement?.scrollTop };});
      assert(reachability.top >= 0 && reachability.bottom <= reachability.height,"Save must be reachable in the actual parent scroll owner");
      assert(reachability.scrollTop > 0,"the narrow form must scroll in its incumbent content pane");
      await capture("save-reachable");
    }
    if (state === "ready" && width === 1536 && theme === "light") {
      const first = page.getByLabel("First name", { exact: true }); await first.focus(); assert.equal(await first.evaluate(e => document.activeElement === e),true);
      for (const name of ["Last name","Email address","Phone number"]) {
        await page.keyboard.press("Tab"); assert.equal(await page.getByLabel(name,{exact:true}).evaluate(e=>document.activeElement===e),true);
      }
      await first.fill("Updated"); await first.press("Enter");
      await page.getByRole("status").filter({ hasText: "Information saved." }).waitFor(); await capture("saved");
      assert.equal(await first.inputValue(), "Updated");
      await first.fill("Retained before leaving"); page.once("dialog",dialog=>dialog.dismiss());
      await page.getByRole("link",{name:"Settings and security",exact:true}).click();
      assert.equal(await first.inputValue(),"Retained before leaving");
      await page.getByRole("button",{name:"Discard edits and reload",exact:true}).click();
      assert.equal(await first.inputValue(),"Updated");
      for (const mode of ["conflict","unknown"]) {
        await page.evaluate(mode => window.accountProof.mode(mode),mode); await first.fill(`Draft ${mode}`);
        await page.getByRole("button", { name: "Save information", exact: true }).click();
        const recover = page.getByRole("button", { name: mode === "unknown" ? "Check saved information" : "Discard edits and reload", exact: true });
        await recover.waitFor(); assert.equal(await first.inputValue(),`Draft ${mode}`); await capture(mode);
        await page.evaluate(() => window.accountProof.mode("ready")); await page.getByRole("button", { name: "Discard edits and reload", exact: true }).click();
        await page.getByRole("button", { name: "Save information", exact: true }).waitFor(); assert.equal(await first.inputValue(),"Updated");
      }
    }
    await page.close();
  }
  assert.deepEqual(errors, []);
  const files = ["src/components/client/ClientAccount.tsx", "src/components/client/useClientAccount.ts", "src/components/client/useClientAccountExit.ts", "src/components/dashboard/ProfileSettings.tsx", "src/components/app/AppNav.tsx", "src/pages/AppShell.tsx"];
  const sources = await Promise.all(files.map(async file => ({ file, sha256: createHash("sha256").update(await fs.readFile(path.join(root,file))).digest("hex") })));
  await fs.writeFile(path.join(output,"result.json"),JSON.stringify({ evidenceClass:"isolated-actual-source-account-parent",auth:"synthetic SDK/RPC, not actual external-client acceptance",network:"all blocked; in-memory documents, no URL navigation or existing profiles",styles,fonts:"incumbent CSS font stack; remote font loading blocked, platform fallback may apply",native:"Account/controller/exit guard/ProfileSettings wrapper/AppShell/AppNav/UI/router/resizer; PAIGE/domain/consent/context/notifications explicit doubles",sources,cases,errors },null,2));
  const review = path.join(root,".impeccable/review"); await fs.mkdir(review,{recursive:true});
  await fs.copyFile(path.join(output,"1536-770-light-a-ready-initial.png"),path.join(review,"desktop.png"));
  await fs.copyFile(path.join(output,"390-844-light-a-ready-initial.png"),path.join(review,"mobile.png"));
  console.log(JSON.stringify({ captures:cases.length,errors:errors.length,output }));
} finally { await browser.close(); }
