// Real-browser check on the BUILT bundle (no auth touched): entry chunk graph
// fetches clean; lazy screen chunks are NOT fetched until imported; an aborted
// screen chunk rejects with the exact error shape ScreenLoadBoundary catches.
const { chromium } = require("playwright");
const { createServer } = require("node:http");
const { readFile, readdirSync, statSync } = require("node:fs");
const { join } = require("node:path");
const dist = "dist/assets";
const port = 4201;
const mime = (f) => f.endsWith(".css") ? "text/css" : "application/javascript";
const server = createServer((req, res) => {
  if (req.url.includes(":4201/")) console.error("REQ", req.url, "->");
  const file = req.url.slice(1).split("?")[0];
  readFile(join(dist, file), (err, data) => {
    if (err) { console.error("  404", req.url); res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "Content-Type": mime(file), "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" });
    res.end(data);
  });
});
(async () => {
  await new Promise((r) => server.listen(port, r));
  const entry = readdirSync(dist).find((f) => f.startsWith("SoloEntry-") && f.endsWith(".js"));
  const settingsChunk = readdirSync(dist).find((f) => /^settings-.*\.js$/.test(f) && statSync(join(dist, f)).size > 100_000);
  const browser = await chromium.launch();
  const page = await browser.newPage();
  let entryOkFinal = 'resolved';
  const fetched = [];
  page.on("request", (r) => { if (r.url().includes(":4201/")) fetched.push(r.url().split("/").pop()); });
  // 1. Entry graph loads clean (bootstrap throw expected on a bare page).
  await page.goto("about:blank");
  const entryOk = await page.evaluate(async (name) => {
    try { await import(`http://localhost:${4201}/${name}`); return "resolved"; }
    catch (err) { return String(err?.message ?? err); }
  }, entry).catch((e) => String(e));
  // A fresh context retry: a transient fetch hiccup on the first context is not a
  // bundle verdict; two failures in a row is.
  if (entryOk !== "resolved") {
    const page2 = await browser.newPage();
    const retry = await page2.evaluate(async (name) => {
      try { await import(`http://localhost:${4201}/${name}?retry=1`); return "resolved"; }
      catch (err) { return String(err?.message ?? err); }
    }, entry).catch((e) => String(e));
    await page2.close();
    entryOkFinal = retry;
  } else entryOkFinal = entryOk;
  const fetchedAtEntry = [...fetched];
  const settingsFetchedAtEntry = fetchedAtEntry.some((f) => /^settings-.*\.js$/.test(f) && f === settingsChunk);
  // 2. Aborting the settings chunk rejects with a fetch-failure shape.
  await page.route(`**/${settingsChunk}`, (route) => route.abort("connectionfailed"));
  const abortError = await page.evaluate(async (name) => {
    try { await import(`http://localhost:${4201}/${name}`); return "resolved"; }
    catch (err) { return { name: err?.constructor?.name, message: String(err?.message ?? err).slice(0, 120) }; }
  }, settingsChunk);
  await page.unroute(`**/${settingsChunk}`);
  // 3. The boundary's detector agrees on that shape.
  const detectorMatch = /dynamically imported module|Importing a module script|error loading dynamically imported|Failed to fetch/i.test(abortError?.message ?? "");
  const receipt = {
    entry, settingsChunk,
    entryGraphBytes: Math.round(fetchedAtEntry.reduce((a, f) => a + (statSync(join(dist, f)).size || 0), 0) / 1024),
    entryOutcome: entryOkFinal,
    lazySettingsChunkFetchedAtEntry: settingsFetchedAtEntry,
    abortedChunkError: abortError,
    boundaryDetectorMatchesAbort: detectorMatch,
  };
  console.log(JSON.stringify(receipt, null, 2));
  await browser.close();
  server.close();
  // The entry graph's expected terminal event on a bare page is the app bootstrap's
// React #299 (createRoot without #root) — i.e., every module fetched, parsed and
// executed. "resolved" never happens here by design.
const entryGraphOk = receipt.entryOutcome === "resolved" || receipt.entryOutcome.includes("Minified React error #299");
process.exit(!entryGraphOk || receipt.lazySettingsChunkFetchedAtEntry || !detectorMatch ? 1 : 0);
})();
