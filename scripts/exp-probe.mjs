import { readFileSync } from "node:fs";
import { createWorker } from "tesseract.js";
import sharp from "sharp";
import { renderPdf } from "../lib/ocr/pdf.ts";

const CANDIDATES = [
  "eng",
  "khm",
  "tha",
  "mya",
  "ara",
  "hin",
  "chi_sim",
  "jpn",
  "kor",
  "deu",
  "rus",
];

for (const target of ["samples/sample.png", "samples/sample-khmer.png"]) {
  const buffer = readFileSync(target);
  const rendered = target.endsWith(".pdf")
    ? await renderPdf(buffer, { scale: 2, maxEdge: 2600 })
    : [{ png: buffer }];
  const png = rendered[0].png;

  // a strip of a few text lines
  const crop = await sharp(png)
    .extract({ left: 90, top: 430, width: 560, height: 120 })
    .grayscale()
    .resize({ width: 560 })
    .png()
    .toBuffer();

  console.log(`\n=== ${target} ===`);
  for (const lang of CANDIDATES) {
    const worker = await createWorker(lang, 1, { logger: () => {} });
    await worker.setParameters({ user_defined_dpi: "300", tessedit_pageseg_mode: "6" });
    const t0 = Date.now();
    const result = await worker.recognize(crop, {}, { blocks: true });
    const words = (result.data.blocks ?? []).flatMap((b) =>
      b.paragraphs.flatMap((p) => p.lines.flatMap((l) => l.words)),
    );
    const confidence = words.length
      ? words.reduce((sum, w) => sum + w.confidence, 0) / words.length
      : 0;
    const text = result.data.text.replace(/\s+/g, " ").trim().slice(0, 34);
    console.log(
      `  ${lang.padEnd(9)} conf=${confidence.toFixed(1).padStart(5)} ${Date.now() - t0}ms  ${JSON.stringify(text)}`,
    );
    await worker.terminate();
  }
}
