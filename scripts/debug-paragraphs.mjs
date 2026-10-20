import { readFileSync } from "node:fs";
import { renderPdf } from "../lib/ocr/pdf.ts";
import { ocrPage, buildDocumentLayout } from "../lib/ocr/recognize.ts";
import { terminateEngine } from "../lib/ocr/engine.ts";

const target = process.argv[2] ?? "samples/sample.pdf";
const buffer = readFileSync(target);
const rendered = target.endsWith(".pdf")
  ? await renderPdf(buffer, { scale: 2, maxEdge: 2600 })
  : [{ png: buffer }];

const { page } = await ocrPage({ png: rendered[0].png }, 0, {
  langs: "eng",
  pdfScale: 2,
  maxImageEdge: 2600,
  deskew: false,
  binarize: false,
  forceColumns: null,
});

for (const region of page.regions) {
  console.log(`\nregion ${region.kind} col=${region.columnIndex} box=${region.bbox.x0}-${region.bbox.x1}`);
  for (const paragraph of region.paragraphs) {
    console.log(
      `  align=${paragraph.align} ind=${paragraph.indentLeftPx.toFixed(0)} size=${paragraph.fontSizePx.toFixed(1)} ls=${paragraph.lineSpacingPx.toFixed(1)}`,
    );
    for (const line of paragraph.lines) {
      console.log(
        `     x=${line.bbox.x0}-${line.bbox.x1} y=${line.baselineY} ${JSON.stringify(line.text.slice(0, 46))}`,
      );
    }
  }
}

await terminateEngine();
