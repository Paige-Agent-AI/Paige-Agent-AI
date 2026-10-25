import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
// Stream pinning and composer geometry when chips are added: where the stream sits before and after,
// how tall the composer grows, and whether Send stays inside the viewport (200% zoom = 640x400).
// "1536-scrolledup" scrolls the stream to 100 before picking: a reader who scrolled up must not be moved.
// "pinnedAt" reads the stream again 1.5s later, after thumbnails and task cards have settled.
const HERE = dirname(fileURLToPath(import.meta.url));
const browser = await chromium.launch(process.env.PW_EXECUTABLE_PATH ? { executablePath: process.env.PW_EXECUTABLE_PATH } : {});
const out = {};
for (const [label, vw, vh, rail, row, n, scrollUp] of [["zoom-7chips", 640, 400, 60, 58, 7], ["zoom-2chips", 640, 400, 60, 58, 2], ["1536-2chips", 1536, 770, 216, 66, 2], ["390-2chips", 390, 844, 60, 58, 2], ["1536-scrolledup", 1536, 770, 216, 66, 2, 100], ["390-scrolledup", 390, 844, 60, 58, 2, 100]]) {
  const page = await browser.newPage({ viewport: { width: vw, height: vh } });
  await page.goto(`http://127.0.0.1:4791/?s=populated&theme=dark&vw=${vw}&vh=${vh}&rail=${rail}&row=${row}&paige=closed&pw=0&me=owner`);
  await page.waitForTimeout(600);
  if (vw < 700) { await page.locator("#th-conv-c-general").click(); await page.waitForTimeout(500); }
  const stream = () => page.evaluate(() => { const s = document.querySelector(".th-conv .th-stream"); return { top: Math.round(s.scrollTop), max: s.scrollHeight - s.clientHeight, client: s.clientHeight }; });
  if (scrollUp != null) { await page.evaluate((y) => { document.querySelector(".th-conv .th-stream").scrollTop = y; }, scrollUp); await page.waitForTimeout(400); }
  const before = await stream();
  await page.evaluate(() => { window.__thFates = { "a.jpg": "hold-upload", "b.png": "hold-check", "d.xlsx": "fail-upload", "g.docx": "reject:macro_content" }; });
  const all = [["a.jpg","image/jpeg",10],["b.png","image/png",10],["c.pdf","application/pdf",10],["d.xlsx","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",10],["e.exe","application/x-msdownload",10],["f.pdf","application/pdf",11*1024*1024],["g.docx","application/vnd.openxmlformats-officedocument.wordprocessingml.document",10]];
  const pickList = n === 2 ? [all[2], all[1]] : all;
  await page.locator(".th-conv input[type=file]").first().setInputFiles(pickList.map(([name, mimeType, size]) => ({ name, mimeType, buffer: Buffer.alloc(size, 32) })));
  await page.waitForTimeout(900);
  const after = await stream();
  const geo = await page.evaluate(() => {
    const send = document.querySelector(".th-conv .th-send").getBoundingClientRect();
    const comp = document.querySelector(".th-conv .th-composer");
    const scrollers = []; let el = comp; while (el) { const cs = getComputedStyle(el); if (/(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight) scrollers.push(el.className); el = el.parentElement; }
    const tray = document.querySelector(".th-conv .th-att-list");
    return { innerH: innerHeight, sendBottom: Math.round(send.bottom), composerH: Math.round(comp.getBoundingClientRect().height), composerOverflowY: getComputedStyle(comp).overflowY, trayOverflowY: tray && getComputedStyle(tray).overflowY, trayMaxH: tray && getComputedStyle(tray).maxHeight, trayClientH: tray && tray.clientHeight, trayScrollH: tray && tray.scrollHeight, scrollers, docScroll: document.scrollingElement.scrollHeight > innerHeight };
  });
  await page.waitForTimeout(1500);
  const settled = await stream();
  const files = vw < 700 ? await page.evaluate(() => [...document.querySelectorAll(".th-conv .th-file[role=group]")].map((el) => {
    const r = (q) => { const n = el.querySelector(q); return n ? n.getBoundingClientRect() : null; };
    const dl = el.querySelector("button[aria-label^='Download']");
    const meta = el.querySelector(".th-file-meta small");
    return { name: el.querySelector(".th-file-name")?.textContent, nameW: Math.round(r(".th-file-name")?.width ?? 0), metaH: Math.round(meta?.getBoundingClientRect().height ?? 0),
      dl: dl ? { w: Math.round(dl.getBoundingClientRect().width), h: Math.round(dl.getBoundingClientRect().height), label: dl.getAttribute("aria-label"), title: dl.getAttribute("title"), visibleText: dl.innerText.trim() } : null };
  })) : undefined;
  out[label] = { before, after, settled, geo, files };
  await page.close();
}
writeFileSync(resolve(HERE, "probe-report.json"), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out));
await browser.close();
