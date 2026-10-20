import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Inspect a running page in headless Chrome with a real device viewport.
 *
 *   node scripts/inspect-ui.mjs [url] [width] [height] [out.png]
 *
 * Reports the document size and every element that sticks out of the
 * viewport, which is how horizontal overflow bugs are found. Optionally
 * writes a screenshot of the emulated viewport.
 */
const url = process.argv[2] ?? "http://localhost:3000";
const width = Number(process.argv[3] ?? 390);
const height = Number(process.argv[4] ?? 844);
const out = process.argv[5];

const chrome =
  process.env.CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const profile = mkdtempSync(path.join(tmpdir(), "orc-inspect-"));

const child = spawn(
  chrome,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--remote-debugging-port=9334",
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
      const response = await fetch("http://127.0.0.1:9334/json");
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

await send("Runtime.enable");
await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", {
  width,
  height,
  deviceScaleFactor: 1,
  mobile: width < 820,
});
await send("Page.reload", { ignoreCache: false });
await new Promise((resolve) => setTimeout(resolve, 2500));

const expression = `(() => {
  const doc = document.documentElement;
  const viewport = window.innerWidth;
  const overflowing = [];
  for (const el of document.querySelectorAll('*')) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    if (rect.right > viewport + 1 || rect.left < -1) {
      overflowing.push({
        tag: el.tagName.toLowerCase(),
        cls: (el.className && String(el.className).slice(0, 40)) || '',
        left: Math.round(rect.left),
        right: Math.round(rect.right),
        width: Math.round(rect.width),
        text: (el.textContent || '').trim().slice(0, 30),
      });
    }
  }
  return JSON.stringify({
    viewport,
    scrollWidth: doc.scrollWidth,
    overflowing: overflowing.slice(0, 20),
  });
})()`;

const result = await send("Runtime.evaluate", { expression, returnByValue: true });
const report = JSON.parse(result.result.result.value);

console.log(`viewport      ${report.viewport}px`);
console.log(`document      ${report.scrollWidth}px wide`);
if (report.scrollWidth > report.viewport + 1) {
  console.log(`\nOVERFLOW by ${report.scrollWidth - report.viewport}px:`);
  for (const item of report.overflowing) {
    console.log(
      `  <${item.tag} class="${item.cls}"> left=${item.left} right=${item.right} w=${item.width} "${item.text}"`,
    );
  }
} else {
  console.log("no horizontal overflow");
}

if (out) {
  const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  writeFileSync(out, Buffer.from(shot.result.data, "base64"));
  console.log(`\nwrote ${out}`);
}

socket.close();
child.kill();
process.exit(0);
