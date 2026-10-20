import { readFileSync } from "node:fs";
import { renderPdf } from "../lib/ocr/pdf.ts";
import {
  loadPageImage,
  analyzeGeometry,
  analyzeProfile,
  buildSlices,
} from "../lib/ocr/image.ts";

/**
 * Show what the layout analysis makes of a page.
 *   node scripts/debug-geometry.mjs samples/sample-khmer.png
 */
const target = process.argv[2] ?? "samples/sample.png";
const buffer = readFileSync(target);
const rendered = target.endsWith(".pdf")
  ? await renderPdf(buffer, { scale: 2, maxEdge: 2600 })
  : [{ png: buffer }];

const page = await loadPageImage(rendered[0].png, { maxEdge: 2600, binarize: false });
const geometry = analyzeGeometry(page.mask, page.width, page.height, null);

console.log(`page ${page.width} x ${page.height}, median row height ${geometry.medianRowHeight}`);
console.log(`columns ${JSON.stringify(geometry.columns)}`);
console.log(`gutters ${JSON.stringify(geometry.gutters)}`);
console.log(`content ${geometry.contentLeft} .. ${geometry.contentRight}`);

const { threshold, runs } = analyzeProfile(page.mask, page.width, page.height);
console.log(`\nprofile threshold ${threshold}, ${runs.length} runs`);
console.log(
  "runs:",
  runs.map((run) => `${run.start}-${run.end}(${run.end - run.start + 1})`).join(" "),
);

console.log("\nbands:");
for (const band of geometry.bands) {
  const runs = [];
  let start = -1;
  for (let x = 0; x <= band.ink.length; x++) {
    const on = x < band.ink.length && band.ink[x] === 1;
    if (on) {
      if (start < 0) start = x;
    } else if (start >= 0) {
      runs.push(`${start}-${x - 1}`);
      start = -1;
    }
  }
  console.log(
    `  y=${band.y0}-${band.y1} h=${band.y1 - band.y0 + 1} x=${band.x0}-${band.x1} cols=[${band.columns.join(",")}] runs=${runs.length > 14 ? `${runs.length} (${runs[0]} .. ${runs[runs.length - 1]})` : runs.join(" ")}`,
  );
}

console.log("\nslices:");
for (const slice of buildSlices(geometry)) {
  console.log(
    `  ${slice.kind} y=${slice.y0}-${slice.y1} cells=${slice.cells
      .map((cell) => `col${cell.columnIndex}[${cell.x0}-${cell.x1}]`)
      .join(" ")}`,
  );
}
