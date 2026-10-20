import { readFileSync, writeFileSync } from "node:fs";

/**
 * End-to-end check against a running server:
 *   node scripts/verify.mjs [baseUrl]
 */
const base = process.argv[2] ?? "http://localhost:3000";

async function ocr(path, options = {}) {
  const form = new FormData();
  const buffer = readFileSync(path);
  form.append("file", new Blob([buffer]), path.split(/[\\/]/).pop());
  form.append("options", JSON.stringify({ langs: "eng", ...options }));

  const response = await fetch(`${base}/api/ocr`, { method: "POST", body: form });
  if (!response.ok) throw new Error(`ocr failed: ${response.status}`);

  const text = await response.text();
  const events = text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const result = events.find((event) => event.type === "result");
  if (!result) {
    const failure = events.find((event) => event.type === "error");
    throw new Error(failure?.message ?? "no result in the stream");
  }
  return result.layout;
}

async function exportDocx(layout, columnMode, fontFamily = "Calibri") {
  const response = await fetch(`${base}/api/export`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      layout,
      options: {
        fontFamily,
        fontSizePt: null,
        columnMode,
        pageSize: "auto",
        preserveSpacing: true,
        preserveBreaks: true,
      },
    }),
  });
  if (!response.ok) throw new Error(`export failed: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

let failures = 0;
function check(label, condition, detail = "") {
  const ok = Boolean(condition);
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` - ${detail}` : ""}`);
}

for (const [name, path, expectedPages] of [
  ["two column PDF", "samples/sample.pdf", 2],
  ["two column image", "samples/sample.png", 1],
]) {
  console.log(`\n=== ${name} ===`);
  const layout = await ocr(path);
  const page = layout.pages[0];

  check("all pages recognised", layout.pages.length === expectedPages, `got ${layout.pages.length}`);
  check("two columns detected", layout.maxColumns === 2, `got ${layout.maxColumns}`);
  check(
    "column gutter is empty",
    page.columns[1].x0 > page.columns[0].x1,
    JSON.stringify(page.columns),
  );

  const columnRegions = page.regions.filter((region) => region.kind === "column");
  check("both columns have content", columnRegions.length >= 2);

  const left = columnRegions.find((region) => region.columnIndex === 0);
  const right = columnRegions.find((region) => region.columnIndex === 1);
  const normalise = (value) => value.replace(/\s+/g, " ").trim();
  const leftText = left ? normalise(left.paragraphs.map((p) => p.text).join(" ")) : "";
  const rightText = right ? normalise(right.paragraphs.map((p) => p.text).join(" ")) : "";

  // if the columns had been merged, both of them would start with the same
  // words
  const leftHead = leftText.slice(0, 40);
  const rightHead = rightText.slice(0, 40);
  check(
    "the columns hold different text",
    leftHead.length > 20 && rightHead.length > 20 && leftHead !== rightHead,
    `${leftHead} / ${rightHead}`,
  );
  check(
    "the left column did not absorb the right one",
    !leftText.includes(rightHead),
    leftHead,
  );
  check(
    "the right column did not absorb the left one",
    !rightText.includes(leftHead),
    rightHead,
  );
  check("text was recognised", layout.pages[0].regions.some((r) => r.paragraphs.length > 0));

  for (const mode of ["auto", "table", "native", "single"]) {
    const buffer = await exportDocx(layout, mode);
    const isZip = buffer[0] === 0x50 && buffer[1] === 0x4b;
    check(`export ${mode}`, isZip && buffer.length > 5000, `${buffer.length} bytes`);
  }

  const docx = await exportDocx(layout, "auto");
  writeFileSync(`samples/${name.replace(/\s+/g, "-")}.docx`, docx);
}

// a broken upload must produce a clean error, not a crash
console.log("\n=== error handling ===");
try {
  const form = new FormData();
  form.append("file", new Blob([Buffer.from("not a document")]), "junk.txt");
  const response = await fetch(`${base}/api/ocr`, { method: "POST", body: form });
  const text = await response.text();
  const events = text.split("\n").filter(Boolean).map((line) => JSON.parse(line));
  const failure = events.find((event) => event.type === "error");
  check("invalid file reports an error", Boolean(failure), failure?.message);
} catch (error) {
  check("invalid file reports an error", false, String(error));
}

console.log("\n=== forced column count ===");
{
  const forcedTwo = await ocr("samples/sample.png", { forceColumns: 2 });
  check("two forced columns", forcedTwo.maxColumns === 2, `got ${forcedTwo.maxColumns}`);

  const forcedOne = await ocr("samples/sample.png", { forceColumns: 1 });
  check("forced single column", forcedOne.maxColumns === 1, `got ${forcedOne.maxColumns}`);
  const singleText = forcedOne.pages[0].regions
    .flatMap((r) => r.paragraphs)
    .map((p) => p.text)
    .join(" ");
  check(
    "single column keeps all the text",
    singleText.includes("right column") && singleText.includes("left column"),
  );
}

console.log("\n=== Khmer ===");
{
  const khmer = await ocr("samples/sample-khmer.png", { langs: "khm" });
  const page = khmer.pages[0];
  check("two columns detected", khmer.maxColumns === 2, `got ${khmer.maxColumns}`);
  check(
    "column gutter is empty",
    page.columns[1].x0 > page.columns[0].x1,
    JSON.stringify(page.columns),
  );

  const text = page.regions.flatMap((r) => r.paragraphs).map((p) => p.text).join(" ");
  check("khmer text recognised", /[\u1780-\u17ff]/.test(text), text.slice(0, 40));
  check("heading recognised", text.includes("របាយការណ៍ទូទៅ"), text.slice(0, 40));

  const columnRegions = page.regions.filter((region) => region.kind === "column");
  const left = columnRegions.find((region) => region.columnIndex === 0);
  const right = columnRegions.find((region) => region.columnIndex === 1);
  const normalise = (value) => value.replace(/\s+/g, " ").trim();
  const leftText = left ? normalise(left.paragraphs.map((p) => p.text).join(" ")) : "";
  const rightText = right ? normalise(right.paragraphs.map((p) => p.text).join(" ")) : "";
  check("khmer left column has text", leftText.length > 40, leftText.slice(0, 40));
  check("khmer right column has text", rightText.length > 40, rightText.slice(0, 40));
  check(
    "khmer columns hold different text",
    leftText.slice(0, 20) !== rightText.slice(0, 20),
  );

  // the font size of the body text should be close to the 30 px it was drawn at
  const bodySizes = page.regions
    .flatMap((r) => r.paragraphs)
    .map((p) => p.fontSizePx)
    .filter((size) => size > 0)
    .sort((a, b) => a - b);
  const bodySize = bodySizes[Math.floor(bodySizes.length / 2)];
  check(
    "khmer body font size is plausible",
    bodySize > 22 && bodySize < 40,
    `${bodySize.toFixed(1)} px`,
  );

  for (const mode of ["auto", "table", "native", "single"]) {
    const buffer = await exportDocx(khmer, mode, null);
    const isZip = buffer[0] === 0x50 && buffer[1] === 0x4b;
    check(`khmer export ${mode}`, isZip && buffer.length > 5000, `${buffer.length} bytes`);
  }

  // the typeface has to be able to render Khmer
  const khmerDocx = await exportDocx(khmer, "auto", null);
  writeFileSync("samples/khmer.docx", khmerDocx);
  const { execFileSync } = await import("node:child_process");
  execFileSync("powershell", [
    "-NoProfile",
    "-Command",
    "Copy-Item samples/khmer.docx samples/khmer.zip -Force; " +
      "Remove-Item samples/khmer-x -Recurse -Force -ErrorAction SilentlyContinue; " +
      "Expand-Archive -Path samples/khmer.zip -DestinationPath samples/khmer-x -Force",
  ]);
  const xml = readFileSync("samples/khmer-x/word/document.xml", "utf8");
  check(
    "khmer document uses a khmer capable font",
    /w:cs="Khmer OS Battambang"/.test(xml),
    (xml.match(/<w:rFonts[^>]*>/) ?? [""])[0],
  );
  check("khmer document is tagged km-KH", /w:val="km-KH"/.test(xml));
  execFileSync("powershell", [
    "-NoProfile",
    "-Command",
    "Remove-Item samples/khmer.zip, samples/khmer-x -Recurse -Force -ErrorAction SilentlyContinue",
  ]);
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
