import { PSM } from "tesseract.js";
import sharp from "sharp";
import { analyzeGeometry, buildSlices, deskewPage, estimateSkew, loadPageImage, type Geometry } from "./image";
import { recognizeCrop, type RecognizedLine } from "./engine";
import { buildParagraphs, normalizeFontSizes } from "../layout/paragraphs";
import type { DocumentLayout, OcrOptions, PageLayout, RegionLayout } from "../types";
import { PAGE_SIZES_TWIPS, LANGUAGE_FONTS } from "../types";

export type PageInput = {
  png: Buffer;
  preview?: string;
};

export type OcrPageResult = {
  page: PageLayout;
  geometry: Geometry;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

async function cropRegion(
  source: Buffer,
  box: { x0: number; y0: number; x1: number; y1: number },
  width: number,
  height: number,
): Promise<Buffer> {
  const left = clamp(Math.floor(box.x0), 0, width - 1);
  const top = clamp(Math.floor(box.y0), 0, height - 1);
  const right = clamp(Math.ceil(box.x1), left + 1, width);
  const bottom = clamp(Math.ceil(box.y1), top + 1, height);
  return sharp(source)
    .extract({ left, top, width: right - left, height: bottom - top })
    .png()
    .toBuffer();
}

function offsetLines(lines: RecognizedLine[], dx: number, dy: number): RecognizedLine[] {
  return lines.map((line) => ({
    ...line,
    bbox: { x0: line.bbox.x0 + dx, y0: line.bbox.y0 + dy, x1: line.bbox.x1 + dx, y1: line.bbox.y1 + dy },
    baselineY: line.baselineY + dy,
    words: line.words.map((word) => ({
      ...word,
      bbox: { x0: word.bbox.x0 + dx, y0: word.bbox.y0 + dy, x1: word.bbox.x1 + dx, y1: word.bbox.y1 + dy },
    })),
  }));
}

/** Recognise a crop, retrying with a taller window when nothing was found. */
async function recognizeRegion(
  source: Buffer,
  box: { x0: number; y0: number; x1: number; y1: number },
  pageWidth: number,
  pageHeight: number,
  psm: PSM,
  langs: string,
  expandBy: number,
): Promise<RecognizedLine[]> {
  const crop = await cropRegion(source, box, pageWidth, pageHeight);
  const lines = await recognizeCrop(crop, { psm, dpi: 150 }, langs);
  if (lines.length || expandBy <= 0) return lines;

  // a very tight crop can leave the engine without enough context to find
  // the baseline, so try again with more room around the text
  const expanded = {
    x0: box.x0,
    y0: Math.max(0, box.y0 - expandBy),
    x1: box.x1,
    y1: Math.min(pageHeight, box.y1 + expandBy),
  };
  const retryCrop = await cropRegion(source, expanded, pageWidth, pageHeight);
  return recognizeCrop(retryCrop, { psm, dpi: 150 }, langs);
}

/** Recognise a single page image and derive its layout. */
export async function ocrPage(
  input: PageInput,
  pageIndex: number,
  options: OcrOptions,
): Promise<OcrPageResult> {
  let png = input.png;

  const page = await loadPageImage(png, {
    maxEdge: options.maxImageEdge,
    binarize: options.binarize,
  });

  if (options.deskew) {
    const angle = estimateSkew(page.gray, page.width, page.height);
    png = await deskewPage(png, angle);
    const corrected = await loadPageImage(png, {
      maxEdge: options.maxImageEdge,
      binarize: options.binarize,
    });
    return ocrPageFromImage(corrected, input.preview, pageIndex, options);
  }

  return ocrPageFromImage(page, input.preview, pageIndex, options);
}

async function ocrPageFromImage(
  page: { width: number; height: number; png: Buffer; mask: Uint8Array },
  preview: string | undefined,
  pageIndex: number,
  options: OcrOptions,
): Promise<OcrPageResult> {
  const geometry = analyzeGeometry(page.mask, page.width, page.height, options.forceColumns);
  const slices = buildSlices(geometry);
  const dpi = 150;

  const regions: RegionLayout[] = [];
  let regionIndex = 0;

  for (const [sliceIndex, slice] of slices.entries()) {
    const padY = Math.max(3, Math.round(geometry.medianRowHeight * 0.35));
    const padX = Math.max(2, Math.round(geometry.medianRowHeight * 0.2));
    const expandBy = Math.max(6, Math.round(geometry.medianRowHeight * 0.9));

    // A crop must not reach into the neighbouring slice, otherwise the same
    // line would be recognised twice - once for the full width block and
    // once for the column.
    const previous = slices[sliceIndex - 1];
    const next = slices[sliceIndex + 1];
    const upperLimit = previous ? previous.y1 + 1 : 0;
    const lowerLimit = next ? next.y0 - 1 : page.height - 1;

    if (slice.kind === "full") {
      const box = {
        x0: slice.x0 - padX,
        y0: Math.max(upperLimit, slice.y0 - padY),
        x1: slice.x1 + padX,
        y1: Math.min(lowerLimit, slice.y1 + padY),
      };
      const lines = await recognizeRegion(
        page.png,
        box,
        page.width,
        page.height,
        PSM.AUTO,
        options.langs,
        expandBy,
      );
      const pageLines = offsetLines(lines, box.x0, box.y0);
      const paragraphs = buildParagraphs({
        lines: pageLines,
        box: { x0: geometry.contentLeft, x1: geometry.contentRight },
        regionIndex,
        preserveBreaks: true,
      });
      regions.push({
        kind: "full",
        columnIndex: -1,
        sliceIndex,
        bbox: { x0: geometry.contentLeft, y0: slice.y0, x1: geometry.contentRight, y1: slice.y1 },
        paragraphs,
      });
      regionIndex++;
    } else {
      for (const cell of slice.cells) {
        const box = {
          x0: cell.x0 - padX,
          y0: Math.max(upperLimit, cell.y0 - padY),
          x1: cell.x1 + padX,
          y1: Math.min(lowerLimit, cell.y1 + padY),
        };
        const lines = await recognizeRegion(
          page.png,
          box,
          page.width,
          page.height,
          PSM.SINGLE_BLOCK,
          options.langs,
          expandBy,
        );
        const pageLines = offsetLines(lines, box.x0, box.y0);
        const column = geometry.columns[cell.columnIndex];
        const paragraphs = buildParagraphs({
          lines: pageLines,
          box: { x0: column?.x0 ?? cell.x0, x1: column?.x1 ?? cell.x1 },
          regionIndex,
          preserveBreaks: true,
        });
        regions.push({
          kind: "column",
          columnIndex: cell.columnIndex,
          sliceIndex,
          bbox: { x0: column?.x0 ?? cell.x0, y0: cell.y0, x1: column?.x1 ?? cell.x1, y1: cell.y1 },
          paragraphs,
        });
        regionIndex++;
      }
    }
  }

  const pageLayout: PageLayout = {
    index: pageIndex,
    widthPx: page.width,
    heightPx: page.height,
    columns: geometry.columns,
    regions,
    image: preview,
  };

  return { page: pageLayout, geometry };
}

/** Derive the document level page setup (size, margins, base font size). */
export function buildDocumentLayout(
  pages: PageLayout[],
  language: string,
  pageSize: keyof typeof PAGE_SIZES_TWIPS | "auto",
): DocumentLayout {
  const first = pages[0];
  const widthPx = first?.widthPx ?? 1240;
  const heightPx = first?.heightPx ?? 1754;

  // the page keeps the aspect ratio of the source, snapped to a real paper size
  let pageWidth = 11906;
  let pageHeight = 16838;
  if (pageSize !== "auto") {
    pageWidth = PAGE_SIZES_TWIPS[pageSize].w;
    pageHeight = PAGE_SIZES_TWIPS[pageSize].h;
  } else {
    const ratio = heightPx / widthPx;
    const candidates = Object.values(PAGE_SIZES_TWIPS);
    let best = candidates[0];
    let bestDiff = Infinity;
    for (const candidate of candidates) {
      const diff = Math.abs(candidate.h / candidate.w - ratio);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = candidate;
      }
    }
    pageWidth = best.w;
    pageHeight = Math.round((best.w * heightPx) / widthPx);
  }

  const scale = pageWidth / widthPx;

  // margins follow the outer edge of the detected text block
  let contentLeft = widthPx;
  let contentRight = 0;
  let contentTop = heightPx;
  let contentBottom = 0;
  const sizes: number[] = [];

  normalizeFontSizes(pages, language);

  const ordered: { bbox: { x0: number; y0: number; x1: number; y1: number }; lines: { baselineY: number; ascentPx: number; descentPx: number; lineSpacingPx?: number }[]; lineSpacingPx: number }[] = [];

  for (const page of pages) {
    for (const region of page.regions) {
      for (const paragraph of region.paragraphs) {
        if (!paragraph.lines.length) continue;
        contentLeft = Math.min(contentLeft, paragraph.bbox.x0);
        contentRight = Math.max(contentRight, paragraph.bbox.x1);
        contentTop = Math.min(contentTop, paragraph.bbox.y0);
        contentBottom = Math.max(contentBottom, paragraph.bbox.y1);
        sizes.push(paragraph.fontSizePx);
        ordered.push({
          bbox: paragraph.bbox,
          lines: paragraph.lines,
          lineSpacingPx: paragraph.lineSpacingPx,
        });
      }
    }
  }

  if (!sizes.length) {
    contentLeft = 0;
    contentRight = widthPx;
    contentTop = 0;
    contentBottom = heightPx;
  }

  // Word puts the text at the bottom of its line box, so a line spacing that
  // is larger than the glyphs adds space *above* the text. Compensate for
  // that to land the first and the last line on their measured position.
  let marginTopPx = contentTop;
  let marginBottomPx = heightPx - contentBottom;

  const firstBlock = ordered.reduce(
    (best, item) => (item.bbox.y0 < best.bbox.y0 ? item : best),
    ordered[0],
  );
  if (firstBlock) {
    const line = firstBlock.lines[0];
    const natural = line.ascentPx + line.descentPx;
    const extra = Math.max(0, firstBlock.lineSpacingPx - natural);
    marginTopPx = Math.max(0, contentTop - extra);
  }
  const lastBlock = ordered.reduce(
    (best, item) => (item.bbox.y1 > best.bbox.y1 ? item : best),
    ordered[ordered.length - 1],
  );
  if (lastBlock) {
    const line = lastBlock.lines[lastBlock.lines.length - 1];
    const natural = line.ascentPx + line.descentPx;
    const extra = Math.max(0, lastBlock.lineSpacingPx - natural);
    marginBottomPx = Math.max(0, heightPx - contentBottom - extra);
  }

  const marginLeft = clamp(Math.round(contentLeft * scale), 0, pageWidth - 1000);
  const marginRight = clamp(Math.round((widthPx - contentRight) * scale), 0, pageWidth - marginLeft - 1000);
  const marginTop = clamp(Math.round(marginTopPx * scale), 0, pageHeight - 1000);
  const marginBottom = clamp(Math.round(marginBottomPx * scale), 0, pageHeight - marginTop - 1000);

  const bodySizes = sizes.filter((s) => s > 0).sort((a, b) => a - b);
  const baseFontSizePx = bodySizes.length ? bodySizes[Math.floor(bodySizes.length * 0.5)] : 16;
  const baseFontSizePt = clamp((baseFontSizePx * scale) / 20, 5, 40);

  const maxColumns = pages.reduce((max, page) => Math.max(max, page.columns.length), 1);

  return {
    pages,
    pageWidth,
    pageHeight,
    marginTop,
    marginRight,
    marginBottom,
    marginLeft,
    baseFontSizePt: Math.round(baseFontSizePt * 2) / 2,
    scale,
    fontFamily: LANGUAGE_FONTS[language] ?? "Calibri",
    maxColumns,
    language,
  };
}
