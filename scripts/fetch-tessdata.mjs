/**
 * Download the Tesseract language data so the app also works without an
 * internet connection.
 *
 *   npm run tessdata            -> english
 *   npm run tessdata -- deu spa -> german and spanish
 *
 * The files end up in ./tessdata and are picked up automatically by the
 * recognition engine when they are present.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const LANGS = process.argv.slice(2).length ? process.argv.slice(2) : ["eng"];
const TARGET = path.join(process.cwd(), "tessdata");
const BASE = "https://cdn.jsdelivr.net/npm/@tesseract.js-data";

mkdirSync(TARGET, { recursive: true });

for (const lang of LANGS) {
  const file = path.join(TARGET, `${lang}.traineddata.gz`);
  if (existsSync(file)) {
    console.log(`${lang}: already present`);
    continue;
  }

  const url = `${BASE}/${lang}/4.0.0_best_int/${lang}.traineddata.gz`;
  process.stdout.write(`${lang}: downloading... `);
  const response = await fetch(url);
  if (!response.ok) {
    console.log(`failed (${response.status})`);
    process.exitCode = 1;
    continue;
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  writeFileSync(file, buffer);
  console.log(`${(buffer.length / 1024 / 1024).toFixed(1)} MB -> ${file}`);
}
