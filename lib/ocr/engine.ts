import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { createWorker, PSM, type Worker } from "tesseract.js";

export type RecognizeOptions = {
  /** page segmentation mode to use for the crop */
  psm: PSM;
  /** resolution hint, avoids the "Estimating resolution" warning */
  dpi: number;
};

export type RecognizedLine = {
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  baselineY: number;
  words: { text: string; bbox: { x0: number; y0: number; x1: number; y1: number }; confidence: number }[];
};

const TESSDATA_DIR = path.join(process.cwd(), "tessdata");
const CACHE_DIR = path.join(process.cwd(), ".cache", "tesseract");

let workerPromise: Promise<Worker> | null = null;
let workerLangs = "";
let queue: Promise<unknown> = Promise.resolve();

type LocalTessdataResult = {
  langPath: string;
  gzip: boolean;
} | null;

function resolveLocalTessdata(langs: string[]): LocalTessdataResult {
  const candidateDirs = [TESSDATA_DIR, process.cwd()];

  for (const dir of candidateDirs) {
    if (!existsSync(/*turbopackIgnore: true*/ dir)) continue;

    // Check compressed (.traineddata.gz)
    const allGz = langs.every((lang) => existsSync(/*turbopackIgnore: true*/ path.join(dir, `${lang}.traineddata.gz`)));
    if (allGz) {
      return { langPath: dir, gzip: true };
    }

    // Check uncompressed (.traineddata)
    const allUncompressed = langs.every((lang) => existsSync(/*turbopackIgnore: true*/ path.join(dir, `${lang}.traineddata`)));
    if (allUncompressed) {
      return { langPath: dir, gzip: false };
    }
  }

  return null;
}

async function createEngineWorker(langs: string): Promise<Worker> {
  const langList = langs.split("+").filter(Boolean);
  mkdirSync(CACHE_DIR, { recursive: true });

  const local = resolveLocalTessdata(langList);
  const worker = await createWorker(langList, 1, {
    // local traineddata files keep the app working without internet access
    langPath: local?.langPath,
    cachePath: CACHE_DIR,
    gzip: local?.gzip ?? true,
    cacheMethod: "write",
    logger: () => {},
    errorHandler: (err) => console.error("[tesseract]", err),
  });

  await worker.setParameters({
    preserve_interword_spaces: "1",
    user_defined_dpi: "300",
  });

  return worker;
}

/** Get (or create) the shared OCR worker, reinitialising it when the language changes. */
export async function getWorker(langs: string): Promise<Worker> {
  if (workerPromise && workerLangs !== langs) {
    const worker = await workerPromise;
    workerPromise = null;
    workerLangs = "";
    await worker.terminate().catch(() => {});
  }
  if (!workerPromise) {
    workerLangs = langs;
    workerPromise = createEngineWorker(langs);
  }
  return workerPromise;
}

/**
 * Recognise a single crop. Calls are serialised because the underlying engine
 * worker can only handle one job at a time.
 */
export async function recognizeCrop(
  image: Buffer,
  options: RecognizeOptions,
  langs: string,
): Promise<RecognizedLine[]> {
  const run = async (): Promise<RecognizedLine[]> => {
    const worker = await getWorker(langs);
    await worker.setParameters({
      tessedit_pageseg_mode: options.psm,
      user_defined_dpi: String(options.dpi),
    });

    const result = await worker.recognize(image, {}, { blocks: true });
    const blocks = result.data.blocks ?? [];
    const lines: RecognizedLine[] = [];

    for (const block of blocks) {
      for (const paragraph of block.paragraphs) {
        for (const line of paragraph.lines) {
          const text = line.text.replace(/\s+$/g, "");
          if (!text.trim()) continue;
          lines.push({
            text,
            bbox: { ...line.bbox },
            baselineY: line.baseline?.y0 ?? line.bbox.y1,
            words: line.words.map((word) => ({
              text: word.text,
              bbox: { ...word.bbox },
              confidence: word.confidence,
            })),
          });
        }
      }
    }
    return lines;
  };

  const task = queue.then(run, run);
  queue = task.catch(() => undefined);
  return task;
}

export async function terminateEngine(): Promise<void> {
  if (!workerPromise) return;
  const worker = await workerPromise;
  workerPromise = null;
  workerLangs = "";
  await worker.terminate();
}
