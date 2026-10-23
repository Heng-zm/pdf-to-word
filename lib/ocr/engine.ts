import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createWorker, PSM, type Worker } from "tesseract.js";
import type { ModelQuality } from "@/lib/types";

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

export const TESSDATA_DIR = path.join(process.cwd(), "tessdata");

/**
 * Resolves a writable cache directory for Tesseract models.
 * In serverless environments (AWS Lambda, Vercel, read-only containers),
 * the filesystem is strictly read-only except for the OS temporary directory (`tmpdir()`).
 * We never attempt to create or write to `process.cwd()` to avoid any `ENOENT` or `EROFS` errors.
 */
export function getCacheDir(): string {
  const custom = process.env.TESSERACT_CACHE_DIR;
  if (custom) {
    try {
      mkdirSync(custom, { recursive: true });
      return custom;
    } catch {
      /* fallback to tmpdir */
    }
  }

  const cacheDir = path.join(tmpdir(), "tesseract-cache");
  try {
    mkdirSync(cacheDir, { recursive: true });
    return cacheDir;
  } catch {
    return tmpdir();
  }
}

const KNOWN_LABELS: Record<string, string> = {
  eng: "English",
  deu: "German",
  fra: "French",
  spa: "Spanish",
  ita: "Italian",
  por: "Portuguese",
  nld: "Dutch",
  pol: "Polish",
  rus: "Russian",
  ukr: "Ukrainian",
  tur: "Turkish",
  ara: "Arabic",
  hin: "Hindi",
  khm: "Khmer",
  mya: "Burmese",
  tha: "Thai",
  lao: "Lao",
  chi_sim: "Chinese (simplified)",
  chi_tra: "Chinese (traditional)",
  jpn: "Japanese",
  kor: "Korean",
  vie: "Vietnamese",
};

export type AvailableModel = {
  name: string;
  label: string;
  sizeBytes: number;
  isCustom: boolean;
  filename: string;
};

/** List all installed local models and user-uploaded custom models. */
export function getAvailableModels(): AvailableModel[] {
  const cacheDir = getCacheDir();
  const candidateDirs = [process.cwd(), TESSDATA_DIR, cacheDir];
  const seen = new Set<string>();
  const models: AvailableModel[] = [];

  for (const dir of candidateDirs) {
    if (!existsSync(/*turbopackIgnore: true*/ dir)) continue;
    try {
      const files = readdirSync(/*turbopackIgnore: true*/ dir);
      for (const file of files) {
        if (file.endsWith(".traineddata") || file.endsWith(".traineddata.gz")) {
          const name = file.replace(/\.traineddata(\.gz)?$/i, "").toLowerCase();
          if (seen.has(name)) continue;
          seen.add(name);
          const fullPath = path.join(/*turbopackIgnore: true*/ dir, file);
          const stat = statSync(/*turbopackIgnore: true*/ fullPath);
          const isCustom = dir === cacheDir;
          const label = KNOWN_LABELS[name] ?? (isCustom ? `${name} (Custom)` : name);
          models.push({
            name,
            label,
            sizeBytes: stat.size,
            isCustom,
            filename: file,
          });
        }
      }
    } catch {
      /* ignore directory read error */
    }
  }

  return models;
}

/** Invalidate and terminate the running OCR worker so model changes take effect immediately. */
export async function invalidateWorker(): Promise<void> {
  if (workerPromise) {
    const existing = await workerPromise.catch(() => null);
    workerPromise = null;
    workerLangs = "";
    if (existing) await existing.terminate().catch(() => {});
  }
}

/**
 * Resolves the Node-targeted Tesseract worker script.
 * In Next.js/Vercel serverless bundles, worker_threads cannot reliably resolve
 * relative paths via internal __dirname. Explicitly resolving via require.resolve
 * or the project root guarantees the worker thread finds the script.
 */
function getWorkerPath(): string | undefined {
  try {
    const { createRequire } = require("node:module");
    const req = createRequire(process.cwd() + "/package.json");
    const resolved = req.resolve("tesseract.js/src/worker-script/node/index.js");
    if (existsSync(/*turbopackIgnore: true*/ resolved)) return resolved;
  } catch {
    /* fallback to direct filesystem path */
  }

  const direct = path.resolve(process.cwd(), "node_modules/tesseract.js/src/worker-script/node/index.js");
  if (existsSync(/*turbopackIgnore: true*/ direct)) {
    return direct;
  }
  return undefined;
}

let workerPromise: Promise<Worker> | null = null;
let workerLangs = "";
let queue: Promise<unknown> = Promise.resolve();

type LocalTessdataResult = {
  langPath: string;
  gzip: boolean;
} | null;

function resolveLocalTessdata(langs: string[], cacheDir?: string): LocalTessdataResult {
  const candidateDirs = [
    TESSDATA_DIR,
    process.cwd(),
    ...(cacheDir ? [cacheDir] : []),
  ];

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

async function createEngineWorker(langs: string, quality: ModelQuality = "best"): Promise<Worker> {
  const langList = langs.split("+").filter(Boolean);
  const cacheDir = getCacheDir();
  const workerPath = getWorkerPath();
  const local = resolveLocalTessdata(langList, cacheDir);

  // If local model is not found, determine the remote CDN based on chosen quality
  let langPath: string | undefined = local?.langPath;
  if (!langPath) {
    if (quality === "fast" || quality === "standard") {
      langPath = "https://tessdata.projectnaptha.com/4.0.0";
    } else {
      // "best": leaving langPath undefined allows tesseract.js to dynamically resolve
      // https://cdn.jsdelivr.net/npm/@tesseract.js-data/${lang}/4.0.0_best_int for each language
      langPath = undefined;
    }
  }

  // Guard worker creation with a 45-second timeout so it never hangs indefinitely
  const worker = await Promise.race([
    createWorker(langList, 1, {
      langPath,
      cachePath: cacheDir,
      workerPath,
      gzip: local?.gzip ?? true,
      cacheMethod: "write",
      logger: (msg) => {
        if (msg.status && msg.status !== "recognizing text") {
          console.log(`[tesseract] ${msg.status} ${msg.progress ? Math.round(msg.progress * 100) + "%" : ""}`);
        }
      },
      errorHandler: (err) => console.error("[tesseract error]", err),
    }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("OCR engine initialization timed out after 45s.")), 45000),
    ),
  ]);

  await worker.setParameters({
    preserve_interword_spaces: "1",
    user_defined_dpi: "300",
  });

  return worker;
}

/** Get (or create) the shared OCR worker, reinitialising it when the language or model quality changes. */
export async function getWorker(langs: string, quality: ModelQuality = "best"): Promise<Worker> {
  const workerKey = `${langs}::${quality}`;
  if (workerPromise && workerLangs !== workerKey) {
    const existing = await workerPromise.catch(() => null);
    workerPromise = null;
    workerLangs = "";
    if (existing) await existing.terminate().catch(() => {});
  }
  if (!workerPromise) {
    workerLangs = workerKey;
    workerPromise = createEngineWorker(langs, quality).catch((err) => {
      // Clear worker state so subsequent attempts can retry instead of being stuck on a rejected promise
      workerPromise = null;
      workerLangs = "";
      throw err;
    });
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
  quality: ModelQuality = "best",
): Promise<RecognizedLine[]> {
  const run = async (): Promise<RecognizedLine[]> => {
    const worker = await getWorker(langs, quality);
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
