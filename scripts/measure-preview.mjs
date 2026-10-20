import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Measure the preview canvas against the space it has.
 *
 *   node scripts/measure-preview.mjs [url] [width] [height]
 */
const url = process.argv[2] ?? "http://localhost:3000";
const width = Number(process.argv[3] ?? 390);
const height = Number(process.argv[4] ?? 844);

const chrome =
  process.env.CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const profile = mkdtempSync(path.join(tmpdir(), "orc-measure-"));

const child = spawn(
  chrome,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--remote-debugging-port=9337",
    `--user-data-dir=${profile}`,
    "--window-size=1280,900",
    url,
  ],
  { stdio: "ignore" },
);

process.on("exit", () => child.kill());

async function waitForTarget() {
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      const response = await fetch("http://127.0.0.1:9337/json");
      const targets = await response.json();
      const page = targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
      if (page) return page;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Chrome did not start");
}

const target = await waitForTarget();
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve) => socket.addEventListener("open", resolve, { once: true }));

let nextId = 1;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message);
    pending.delete(message.id);
  }
});

function send(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    socket.send(JSON.stringify({ id, method, params }));
  });
}

const evaluate = async (expression) => {
  const response = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  return response.result?.result?.value;
};

await send("Runtime.enable");
await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", {
  width,
  height,
  deviceScaleFactor: 1,
  mobile: width < 820,
});
await send("Page.reload");
await new Promise((resolve) => setTimeout(resolve, 2000));

await evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent.includes('Try the sample'))?.click()`);
await new Promise((resolve) => setTimeout(resolve, 900));
await evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Recognise text')?.click()`);
for (let attempt = 0; attempt < 90; attempt++) {
  await new Promise((resolve) => setTimeout(resolve, 1000));
  if (await evaluate(`Boolean(document.querySelector('.canvas-wrap'))`)) break;
}
await new Promise((resolve) => setTimeout(resolve, 1200));

const report = await evaluate(`(() => {
  const wrap = document.querySelector('.canvas-wrap');
  const scroll = document.querySelector('.canvas-scroll');
  if (!wrap || !scroll) return JSON.stringify({ missing: true });
  const w = wrap.getBoundingClientRect();
  const s = scroll.getBoundingClientRect();
  const frame = document.querySelector('.page-frame').getBoundingClientRect();
  return JSON.stringify({
    canvas: Math.round(w.width),
    canvasHeight: Math.round(w.height),
    scroll: Math.round(s.width),
    frame: Math.round(frame.width),
    overflows: Math.round(w.width) > Math.round(s.width) + 1,
    fontSize: getComputedStyle(document.querySelector('.para')).fontSize,
    viewport: window.innerWidth,
  });
})()`);

console.log(JSON.stringify(JSON.parse(report), null, 2));

socket.close();
child.kill();
process.exit(0);
