import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";

export type RenderedPage = {
  png: Buffer;
  width: number;
  height: number;
};

/**
 * Render every page of a PDF into a PNG image.
 *
 * pdf.js is loaded from the legacy build because the modern one expects a
 * browser-ish environment; the canvas is provided by @napi-rs/canvas.
 */
export async function renderPdf(
  data: Buffer,
  opts: { scale: number; maxEdge: number },
): Promise<RenderedPage[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

  const doc = await pdfjs.getDocument({
    data: new Uint8Array(data),
    useSystemFonts: true,
    disableFontFace: true,
  }).promise;

  const pages: RenderedPage[] = [];
  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
    const page = await doc.getPage(pageNumber);
    let viewport = page.getViewport({ scale: opts.scale });

    const longest = Math.max(viewport.width, viewport.height);
    if (longest > opts.maxEdge) {
      viewport = page.getViewport({
        scale: (opts.scale * opts.maxEdge) / longest,
      });
    }

    const width = Math.max(1, Math.ceil(viewport.width));
    const height = Math.max(1, Math.ceil(viewport.height));
    const canvas = createCanvas(width, height);
    const context = canvas.getContext("2d");
    // pdf.js expects a white background, otherwise transparent areas turn black
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);

    await page.render({
      canvasContext: context as unknown as CanvasRenderingContext2D,
      viewport,
      canvas: canvas as unknown as HTMLCanvasElement,
      background: "#ffffff",
    }).promise;

    pages.push({ png: canvas.toBuffer("image/png"), width, height });
    page.cleanup();
  }

  await doc.cleanup();
  return pages;
}

export function isPdf(buffer: Buffer): boolean {
  return buffer.length > 4 && buffer.subarray(0, 4).toString("latin1") === "%PDF";
}

export function isImage(buffer: Buffer): boolean {
  if (buffer.length < 12) return false;
  const png = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
  if (png) return true;
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return true; // jpeg
  if (buffer.subarray(0, 4).toString("latin1") === "RIFF" && buffer.subarray(8, 12).toString("latin1") === "WEBP")
    return true;
  if (buffer.subarray(0, 2).toString("latin1") === "BM") return true;
  return false;
}

/** Build a small preview data-url so the browser can show the source page. */
export async function toPreviewDataUrl(png: Buffer, maxWidth = 900): Promise<string> {
  const sharp = (await import("sharp")).default;
  const resized = await sharp(png)
    .resize({ width: maxWidth, withoutEnlargement: true })
    .jpeg({ quality: 72 })
    .toBuffer();
  return `data:image/jpeg;base64,${resized.toString("base64")}`;
}
