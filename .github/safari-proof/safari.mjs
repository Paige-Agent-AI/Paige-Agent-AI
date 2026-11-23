import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { build } from "vite";
import react from "@vitejs/plugin-react-swc";

const fixture = "exp00-native-safari-fixture";
const stub = "22222222-2222-4222-8222-222222222222";
const mocks = {
  "@/lib/voice/fetchMessageAudio": 'export async function fetchMessageAudio(){throw new Error("Unexpected opening voice request");}',
  "@/lib/paigeLiveConversation/client": [
    'const result={ok:true,sessionId:' + JSON.stringify(stub) + ',ticket:"fixture",availability:"PROOF OWED"};',
    'export const startPaigeLiveConversation=async()=>result;',
    'export const renewPaigeLiveRelayTicket=async()=>result;',
    'export const acceptPaigeLiveTerms=async()=>({accepted:true});',
    'export const transitionPaigeLiveConversation=async()=>({ok:true});',
  ].join("\n"),
  "@/lib/paigeLiveConversation/relayTransport": [
    'export function connectPaigeLiveRelay(input){',
    'let playing=false,held=false;',
    'const listeners=new Set();const notify=()=>listeners.forEach(l=>l());',
    'const ready=()=>input.onState({kind:"ready"});',
    'const clear=()=>{playing=false;notify()};',
    'window.filmSpeak=()=>{playing=true;input.onState({kind:"speaking"});notify()};setTimeout(ready,70);',
    'return {subscribeOutput(l){listeners.add(l);return ()=>listeners.delete(l)},outputPlaying:()=>playing&&!held,',
    'outputCaption:()=>"Your follow-up can start with the next step you agreed on.",',
    'readEnergy:()=>({amplitude:.12+Math.pow(Math.sin(performance.now()/103),4)*.72,brightness:.25}),',
    'clearOutput:clear,pauseOutput(){held=true;notify()},resumeOutput(){held=false;notify()},',
    'setMuted(){},interrupt(){clear();ready()},stop:clear,runtimeProof(){},runtimeFailed(){}};}',
  ].join("\n"),
};

async function buildFixture(root, destination) {
  process.chdir(root);
  const html = path.join(root, fixture + ".html");
  const entry = path.join(root, fixture + ".tsx");
  const source = [
    'import {createRoot} from "react-dom/client";',
    'import {PaigeLiveConversation} from "./src/components/paige/live/PaigeLiveConversation";',
    'import "./src/index.css";',
    'const thread="11111111-1111-4111-8111-111111111111";',
    'createRoot(document.getElementById("root")!).render(<main><PaigeLiveConversation contextEpoch="native-safari-fixture" threadId={thread} ensureThread={async()=>thread} transcript={[{id:"m1",role:"user",content:"Can you help with a follow-up?"}]} activeCard={null} working={false} onAnswer={()=>{}} onApprove={()=>{}} onDecline={()=>{}} onVoiceTurn={()=>{}} onVoiceInterrupt={()=>{}} /></main>);',
  ].join("\n");
  await writeFile(html, '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Meet PAIGE motion proof</title><div id="root"></div><script type="module" src="/' + fixture + '.tsx"></script>', { flag: "wx" });
  try {
    await writeFile(entry, source, { flag: "wx" });
    try {
      await build({
        configFile: false, root, base: "./",
        plugins: [{
          name: "fixture-relay", enforce: "pre",
          resolveId(id) { if (id.startsWith("\0") && Object.hasOwn(mocks, id.slice(1))) return id; },
          load(id) { if (id.startsWith("\0")) return mocks[id.slice(1)]; },
        }, react()],
        resolve: { alias: [
          ...Object.keys(mocks).map(find => ({ find, replacement: "\0" + find })),
          { find: "@", replacement: path.join(root, "src") },
        ] },
        build: { outDir: destination, rollupOptions: { input: html } },
      });
    } finally { await unlink(entry); }
  } finally { await unlink(html); }
}

const types = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp",
};
const origin = "http://127.0.0.1:4380";
const driverUrl = "http://127.0.0.1:4444";
const csp = "default-src 'self' data: blob:; connect-src 'none'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'";

async function driver(method, endpoint, body) {
  const response = await fetch(driverUrl + endpoint, {
    method, headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(25_000),
  });
  const { value } = await response.json();
  if (!response.ok) throw new Error(endpoint + " " + (value?.error ?? response.status) + " " + (value?.message ?? ""));
  return value;
}

async function until(predicate, label, timeout = 12_000) {
  const expires = Date.now() + timeout;
  while (Date.now() < expires) {
    if (await predicate()) return;
    await wait(125);
  }
  throw new Error("Timed out waiting for " + label);
}

function browserProbe() {
  window.motionLog = { raf: [], galaxy: [], wave: [] };
  const clear = CanvasRenderingContext2D.prototype.clearRect;
  CanvasRenderingContext2D.prototype.clearRect = function (...args) {
    const key = this.canvas.classList.contains("plc-film-galaxy") ? "galaxy" : this.canvas.closest(".plc-film-audio") ? "wave" : undefined;
    if (key) window.motionLog[key].push(performance.now());
    return clear.apply(this, args);
  };
  const record = now => {
    window.motionLog.raf.push(now);
    requestAnimationFrame(record);
  };
  requestAnimationFrame(record);
}

function measureWindow(duration, done) {
  const incoming = document.querySelector(".plc-film-galaxy");
  const mark = document.querySelector(".plc-film-mark");
  const start = performance.now();
  const initialTransform = getComputedStyle(incoming).transform;
  const initialMark = mark && getComputedStyle(mark).transform;
  setTimeout(() => {
    const elapsed = performance.now() - start;
    const finalTransform = getComputedStyle(incoming).transform;
    const measures = Object.fromEntries(Object.entries(window.motionLog).map(([key, values]) => {
      const sample = values.filter(value => value >= start && value < start + duration);
      const deltas = sample.slice(1).map((value, index) => value - sample[index]).sort((a, b) => a - b);
      return [key, { count: sample.length, p95ms: +(deltas[Math.floor(deltas.length * .95)] ?? 0).toFixed(2) }];
    }));
    done({ elapsed, transformChanged: initialTransform !== finalTransform, markChanged: Boolean(mark && getComputedStyle(mark).transform !== initialMark), hidden: document.hidden, measures });
  }, duration);
}

async function exercise(sessionId, version, width, height, article, reduced) {
  const endpoint = "/session/" + sessionId;
  const sync = (fn, ...args) => driver("POST", endpoint + "/execute/sync", { script: "return (" + fn.toString() + ")(...arguments)", args });
  const asyncScript = (fn, ...args) => driver("POST", endpoint + "/execute/async", { script: "return (" + fn.toString() + ")(...arguments)", args });
  const route = origin + "/" + article + "/" + fixture + ".html";
  await driver("POST", endpoint + "/window/rect", { width, height, x: 0, y: 0 });
  await driver("POST", endpoint + "/url", { url: route });
  const actual = await sync(() => ({
    width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
    screenWidth: screen.width, screenHeight: screen.height,
    nativeReduced: matchMedia("(prefers-reduced-motion: reduce)").matches,
    hidden: document.hidden, userAgent: navigator.userAgent,
  }));
  console.log(JSON.stringify({ event: "native-geometry", version, article, reduced, ...actual }));
  assert(actual.width >= 1280 && actual.height >= 720, "Native Safari viewport is smaller than desktop acceptance geometry");
  assert(actual.dpr >= 2, "The native macOS runner did not expose a Retina device pixel ratio");
  assert.equal(actual.hidden, false, "Safari must be foreground");
  assert.equal(actual.nativeReduced, reduced, "Native macOS motion preference did not reach Safari");
  await sync(browserProbe);

  async function click(label) {
    await until(() => sync(text => [...document.querySelectorAll("button")].some(b => b.textContent.trim() === text && !b.disabled), label), label);
    const buttons = await driver("POST", endpoint + "/elements", { using: "xpath", value: "//button[normalize-space(.)=" + JSON.stringify(label) + "]" });
    assert(buttons.length > 0, "Cannot locate the enabled control " + label);
    await driver("POST", endpoint + "/element/" + Object.values(buttons[0])[0] + "/click", {});
  }

  await click("Talk live with Paige");
  let opening = null;
  if (!reduced) {
    await until(() => sync(() => {
      const mark = document.querySelector(".plc-film-mark-flight");
      return mark && mark.getAnimations().some(animation => animation.playState === "running");
    }), "the actual Command Logo animation");
    opening = await asyncScript(measureWindow, 1200);
    assert(!opening.hidden && opening.markChanged && opening.measures.raf.count > 0, "The opening logo did not animate in the foreground");
  } else {
    assert.equal(await sync(() => document.querySelectorAll(".plc-film-mark-flight").length), 0);
  }
  await until(() => sync(() => {
    const stage = document.querySelector('[role="dialog"]');
    return stage?.textContent.includes("Listening") === true && typeof window.filmSpeak === "function";
  }), "natural intro completion and listening");

  await until(() => sync(() => {
    const canvas = document.querySelector(".plc-film-galaxy");
    if (!canvas || canvas.width < 32 || canvas.height < 32) return false;
    return canvas.getContext("2d").getImageData(Math.floor(canvas.width / 2) - 6, Math.floor(canvas.height * (.5)) - 6, 12, 12).data.some((value, i) => i % 4 === 3 && value > 0)
      || canvas.getContext("2d").getImageData(Math.floor(canvas.width / 2) - 6, Math.floor(canvas.height * .4) - 6, 12, 12).data.some((value, i) => i % 4 === 3 && value > 0);
  }), "visible galaxy pixels");
  const timing = await sync(() => {
    const dock = document.querySelector(".plc-film-audio").getBoundingClientRect();
    const controls = document.querySelector(".plc-controls").getBoundingClientRect();
    const stage = document.querySelector(".plc-stage__main");
    return { dockTop: dock.top, dockBottom: dock.bottom, controlsTop: controls.top, scroll: stage.scrollWidth, width: stage.clientWidth };
  });
  assert(timing.dockBottom <= timing.controlsTop + 1, "Waveform dock escaped the bottom of the stage");
  assert(timing.scroll <= timing.width + 1, "Galaxy introduced horizontal stage overflow");
  assert.equal(await sync(() => document.querySelectorAll(".plc-film-caption__cue p").length), 0);
  await sync(() => { window.filmSpeak(); });
  await until(() => sync(() => document.querySelector(".plc-film-caption__cue p")?.textContent.includes("next step you agreed on") === true &&
    document.querySelector(".plc-film-audio").dataset.playing === "true"), "caption and playback waveform");
  await wait(450);
  const samples = [];
  for (let index = 0; index < (reduced ? 1 : 3); index++) {
    samples.push(await asyncScript(measureWindow, 1500));
  }
  assert(samples.every(sample => !sample.hidden), "The browser became hidden during measurement");
  if (reduced) {
    assert(samples[0].measures.wave.count > 0, "Reduced motion removed playback feedback");
    assert(!samples[0].transformChanged && samples[0].measures.galaxy.count === 0, "Reduced motion did not hold the galaxy");
  } else if (article === "candidate") {
    assert(samples.every(sample => sample.transformChanged && sample.measures.galaxy.count === 0), "Candidate galaxy did not move using cached textures");
  } else assert(samples.every(sample => sample.measures.galaxy.count > 0), "Baseline galaxy produced no animation work");
  await click("Hold");
  await until(() => sync(() => document.querySelectorAll(".plc-film-caption__cue p").length === 0), "caption to clear on Hold");
  await click("Resume");
  await until(() => sync(() => document.querySelectorAll(".plc-film-caption__cue p").length === 1), "caption return on Resume");
  await click("Interrupt");
  await until(() => sync(() => document.querySelectorAll(".plc-film-caption__cue p").length === 0), "caption to clear after Interrupt");
  await click("End");
  await until(() => sync(() => document.querySelector('[role="dialog"]') === null), "End to return to the workspace fixture");
  return { article, reduced, version, actual, timing, opening, samples };
}

async function runNative(root, destination) {
  await mkdir(destination, { recursive: true });
  const summary = [];
  const options = { stdio: "inherit" };
  const deployFile = path.join(destination, "native-safari-result.json");
  const host = createServer(async (request, response) => {
    try {
      const uri = new URL(request.url, origin);
      const resolved = path.resolve(root, "." + decodeURIComponent(uri.pathname));
      if (!resolved.startsWith(root + path.sep)) throw new Error("Fixture path outside the root");
      const body = await readFile(resolved);
      response.writeHead(200, { "Content-Type": types[path.extname(resolved)] ?? "application/octet-stream", "Content-Security-Policy": csp });
      response.end(body);
    } catch { response.writeHead(404); response.end(); }
  });
  await new Promise((resolve, reject) => host.once("error", reject).listen(4380, "127.0.0.1", resolve));
  const process = spawn("/usr/bin/safaridriver", ["-p", "4444"], options);
  try {
    await until(async () => {
      try { await driver("GET", "/status"); return true; }
      catch { return false; }
    }, "native SafariDriver");
    for (const reduced of [false, true]) {
      execFileSync("/usr/bin/defaults", ["write", "com.apple.universalaccess", "reduceMotion", "-bool", String(reduced)]);
      const session = await driver("POST", "/session", { capabilities: { alwaysMatch: { browserName: "safari" } } });
      try {
        const version = session.capabilities.browserVersion;
        assert.equal(session.capabilities.browserName.toLowerCase(), "safari");
        assert(session.capabilities.platformName.toLowerCase().includes("mac"));
        for (const article of reduced ? ["candidate"] : ["baseline", "candidate"]) {
          summary.push(await exercise(session.sessionId, version, 1450, 980, article, reduced));
          console.log("NATIVE_SAFARI_SAMPLE=" + JSON.stringify(summary.at(-1)));
          await writeFile(deployFile, JSON.stringify({ status: "IN_PROGRESS", summary }, null, 2));
        }
      } finally { await driver("DELETE", "/session/" + session.sessionId).catch(console.error); }
    }
    const before = summary.find(sample => sample.article === "baseline");
    const after = summary.find(sample => sample.article === "candidate" && !sample.reduced);
    assert.deepEqual(after.actual, before.actual, "Native geometry and settings shifted between the baseline and candidate");
    const median = (list, selector) => list.map(selector).sort((a, b) => a - b)[1];
    const beforeWave = median(before.samples, sample => sample.measures.wave.count);
    const afterWave = median(after.samples, sample => sample.measures.wave.count);
    const beforeP95 = median(before.samples, sample => sample.measures.wave.p95ms);
    const afterP95 = median(after.samples, sample => sample.measures.wave.p95ms);
    assert(afterWave >= beforeWave * 1.25 && afterP95 <= beforeP95, "Candidate did not establish smoother native Safari playback than the comparable baseline");
    await writeFile(deployFile, JSON.stringify({ status: "PASS", beforeWave, afterWave, beforeP95, afterP95, summary }, null, 2));
    console.log("NATIVE_SAFARI_RESULT=PASS");
  } catch (error) {
    await writeFile(deployFile, JSON.stringify({ status: "NOT_PASSED", error: error.message, summary }, null, 2));
    throw error;
  } finally {
    process.kill("SIGTERM");
    host.close();
    try { execFileSync("/usr/bin/defaults", ["delete", "com.apple.universalaccess", "reduceMotion"], { stdio: "ignore" }); }
    catch { /* The hosted runner is disposable. Preserve the measurement result. */ }
  }
}

const [, , command, first, second] = process.argv;
if (command === "build") await buildFixture(first, second);
else if (command === "drive") await runNative(first, second);
else throw new Error("Expected build or drive");
