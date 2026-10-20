import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * End to end test of the browser interface: load the sample, recognise it,
 * edit a block, switch views and check that the document can be exported.
 *
 *   node scripts/test-ui.mjs [url]
 */
const url = process.argv[2] ?? "http://localhost:3000";

const chrome =
  process.env.CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const profile = mkdtempSync(path.join(tmpdir(), "orc-uitest-"));

const child = spawn(
  chrome,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--remote-debugging-port=9336",
    `--user-data-dir=${profile}`,
    "--window-size=1440,900",
    url,
  ],
  { stdio: "ignore" },
);

process.on("exit", () => child.kill());

async function waitForTarget() {
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      const response = await fetch("http://127.0.0.1:9336/json");
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
  const response = await send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (response.result?.exceptionDetails) {
    throw new Error(response.result.exceptionDetails.text ?? "evaluation failed");
  }
  return response.result?.result?.value;
};

let failures = 0;
function check(label, condition, detail = "") {
  const ok = Boolean(condition);
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` - ${detail}` : ""}`);
}

await send("Runtime.enable");
await send("Page.enable");
await send("Page.reload");
await new Promise((resolve) => setTimeout(resolve, 2000));

// 1. the empty state offers the sample
check(
  "empty state offers the sample",
  await evaluate(`[...document.querySelectorAll('button')].some((b) => b.textContent.includes('Try the sample'))`),
);

// 2. load the sample and recognise it
await evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent.includes('Try the sample'))?.click()`);
await new Promise((resolve) => setTimeout(resolve, 1000));
check(
  "the sample appears as a file",
  await evaluate(`[...document.querySelectorAll('.file-chip .name')].some((n) => n.textContent.includes('sample.pdf'))`),
);

await evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Recognise text')?.click()`);

let ready = false;
for (let attempt = 0; attempt < 90; attempt++) {
  await new Promise((resolve) => setTimeout(resolve, 1000));
  if (await evaluate(`Boolean(document.querySelector('.page-frame'))`)) {
    ready = true;
    break;
  }
}
check("the result is rendered", ready);
check("both pages are shown", (await evaluate(`document.querySelectorAll('.page-frame').length`)) === 2);
check(
  "the recognised text is on the page",
  (await evaluate(`document.querySelector('.para')?.innerText ?? ''`)).includes("Product Requirements"),
);

// 3. edit a block
const edited = await evaluate(`(() => {
  const target = [...document.querySelectorAll('.para')].find((p) => p.innerText.includes('Product Requirements'));
  if (!target) return null;
  target.focus();
  target.innerText = 'Edited heading text';
  // React maps onBlur to the bubbling focusout event
  target.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  return target.innerText;
})()`);
check("a block can be edited", edited === "Edited heading text", String(edited));

// 4. the inspector shows the selected block
check(
  "the inspector follows the selection",
  await evaluate(`document.querySelector('.inspector-side .kv b')?.textContent?.length > 0`),
);

// 5. the text view lists the recognised text
await evaluate(`[...document.querySelectorAll('.tabs button')].find((b) => b.textContent.trim() === 'Text')?.click()`);
await new Promise((resolve) => setTimeout(resolve, 400));
check(
  "the text view lists the paragraphs",
  (await evaluate(`document.querySelectorAll('.panel-body p').length`)) > 5,
);

// 6. export really produces a file, with the edited text in it
const downloadDir = mkdtempSync(path.join(tmpdir(), "orc-download-"));
await send("Browser.setDownloadBehavior", {
  behavior: "allow",
  downloadPath: downloadDir,
  eventsEnabled: true,
});

await evaluate(`[...document.querySelectorAll('.tabs button')].find((b) => b.textContent.trim() === 'Layout')?.click()`);
await new Promise((resolve) => setTimeout(resolve, 300));
await evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent.includes('Download DOCX'))?.click()`);

let downloaded = "";
for (let attempt = 0; attempt < 30; attempt++) {
  await new Promise((resolve) => setTimeout(resolve, 500));
  const files = readdirSync(downloadDir).filter((name) => name.endsWith(".docx"));
  if (files.length) {
    downloaded = path.join(downloadDir, files[0]);
    break;
  }
}
check("the download starts", Boolean(downloaded), downloaded);

if (downloaded) {
  const bytes = readFileSync(downloaded);
  check("the download is a docx", bytes[0] === 0x50 && bytes[1] === 0x4b, `${bytes.length} bytes`);
  // the document is a zip, so the word/document.xml can be read from it
  const { execFileSync } = await import("node:child_process");
  const extracted = path.join(downloadDir, "x");
  execFileSync("powershell", [
    "-NoProfile",
    "-Command",
    `Copy-Item "${downloaded}" "${downloaded}.zip" -Force; Expand-Archive -Path "${downloaded}.zip" -DestinationPath "${extracted}" -Force`,
  ]);
  const xml = readFileSync(path.join(extracted, "word", "document.xml"), "utf8");
  check("the edited text reached the document", xml.includes("Edited heading text"));
  check(
    "the column gutter is in the document",
    /w:tbl/.test(xml) && /w:gridCol/.test(xml),
  );
}

console.log(failures === 0 ? "\nAll UI checks passed." : `\n${failures} check(s) failed.`);

socket.close();
child.kill();
process.exit(failures === 0 ? 0 : 1);
