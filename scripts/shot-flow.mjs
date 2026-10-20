import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Drive the app in headless Chrome: load the sample, recognise it and
 * capture the result. Used to check the layout of the working view.
 *
 *   node scripts/shot-flow.mjs [url] [width] [height] [out.png]
 */
const url = process.argv[2] ?? "http://localhost:3000";
const width = Number(process.argv[3] ?? 390);
const height = Number(process.argv[4] ?? 844);
const out = process.argv[5] ?? "scripts/shot-flow.png";

const chrome =
  process.env.CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const profile = mkdtempSync(path.join(tmpdir(), "orc-flow-"));

const child = spawn(
  chrome,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--remote-debugging-port=9335",
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
      const response = await fetch("http://127.0.0.1:9335/json");
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

// load the bundled sample and start the recognition
await evaluate(`(() => {
  const buttons = [...document.querySelectorAll('button')];
  const sample = buttons.find((b) => b.textContent.includes('Try the sample'));
  if (sample) sample.click();
  return Boolean(sample);
})()`);
await new Promise((resolve) => setTimeout(resolve, 1200));
await evaluate(`(() => {
  const buttons = [...document.querySelectorAll('button')];
  const run = buttons.find((b) => b.textContent.trim() === 'Recognise text');
  if (run) run.click();
  return Boolean(run);
})()`);

// wait for the result
for (let attempt = 0; attempt < 60; attempt++) {
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const done = await evaluate(`Boolean(document.querySelector('.page-frame'))`);
  if (done) break;
}

await new Promise((resolve) => setTimeout(resolve, 1500));

const report = await evaluate(`(() => {
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
    pages: document.querySelectorAll('.page-frame').length,
    overflowing: overflowing.slice(0, 20),
  });
})()`);

const info = JSON.parse(report);
console.log(`viewport   ${info.viewport}px`);
console.log(`document   ${info.scrollWidth}px wide`);
console.log(`pages      ${info.pages}`);
if (info.scrollWidth > info.viewport + 1) {
  console.log(`\nOVERFLOW by ${info.scrollWidth - info.viewport}px:`);
  for (const item of info.overflowing) {
    console.log(
      `  <${item.tag} class="${item.cls}"> left=${item.left} right=${item.right} w=${item.width} "${item.text}"`,
    );
  }
} else {
  console.log("no horizontal overflow");
}

const shot = await send("Page.captureScreenshot", { format: "png" });
writeFileSync(out, Buffer.from(shot.result.data, "base64"));
console.log(`wrote ${out}`);

socket.close();
child.kill();
process.exit(0);
