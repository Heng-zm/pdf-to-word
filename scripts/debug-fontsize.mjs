import { readFileSync } from "node:fs";
import { loadPageImage } from "../lib/ocr/image.ts";
import { renderPdf } from "../lib/ocr/pdf.ts";
import { ocrPage } from "../lib/ocr/recognize.ts";
import { terminateEngine } from "../lib/ocr/engine.ts";

/**
 * Print the measured ascent per line together with the font size that was
 * derived from it. The ratio between the two is what the script specific
 * ASCENT_RATIOS table is built from.
 */
const target = process.argv[2] ?? "samples/sample-khmer.png";
const lang = process.argv[3] ?? "khm";

const buffer = readFileSync(target);
const rendered = target.endsWith(".pdf")
  ? await renderPdf(buffer, { scale: 2, maxEdge: 2600 })
  : [{ png: buffer }];
const page = await loadPageImage(rendered[0].png, { maxEdge: 2600, binarize: false });
const { page: layout } = await ocrPage({ png: page.png }, 0, {
  langs: lang,
  pdfScale: 2,
  maxImageEdge: 2600,
  deskew: false,
  binarize: false,
  forceColumns: null,
});

for (const region of layout.regions) {
  for (const paragraph of region.paragraphs) {
    console.log(`\nparagraph size=${paragraph.fontSizePx.toFixed(1)}px`);
    for (const line of paragraph.lines) {
      console.log(
        `   ascent=${line.fontSizePx.toFixed(1)}px  baseline=${line.baselineY}  ${JSON.stringify(line.text.slice(0, 40))}`,
      );
    }
  }
}

await terminateEngine();
