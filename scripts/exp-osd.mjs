import { readFileSync } from "node:fs";
import { createWorker } from "tesseract.js";
import sharp from "sharp";
import { renderPdf } from "../lib/ocr/pdf.ts";

const worker = await createWorker("eng", 1, {
  legacyCore: true,
  legacyLang: true,
  logger: () => {},
});
await worker.setParameters({ user_defined_dpi: "300" });

for (const target of ["samples/sample.png", "samples/sample-khmer.png"]) {
  const buffer = readFileSync(target);
  const rendered = target.endsWith(".pdf")
    ? await renderPdf(buffer, { scale: 2, maxEdge: 2600 })
    : [{ png: buffer }];
  const png = rendered[0].png;

  // a few single line crops
  const crops = [
    ["line1", { left: 90, top: 100, width: 600, height: 60 }],
    ["line2", { left: 90, top: 200, width: 600, height: 60 }],
    ["line3", { left: 690, top: 430, width: 550, height: 60 }],
  ];
  for (const [name, rect] of crops) {
    const crop = await sharp(png).extract(rect).png().toBuffer();
    try {
      const result = await worker.detect(crop);
      console.log(
        `${target} ${name}: script=${result.data.script} id=${result.data.tesseract_script_id} conf=${result.data.script_confidence} orient=${result.data.orientation_degrees}`,
      );
    } catch (error) {
      console.log(`${target} ${name}: FAILED ${error.message}`);
    }
  }
}

await worker.terminate();
