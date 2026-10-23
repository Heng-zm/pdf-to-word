import type { Align, LineLayout, PageLayout, ParagraphLayout } from "../types";
import { ASCENT_RATIOS, DEFAULT_ASCENT_RATIO } from "../types";
import type { RecognizedLine } from "../ocr/engine";

export type ContentBox = { x0: number; x1: number };



let paragraphCounter = 0;
export function resetParagraphIds(): void {
  paragraphCounter = 0;
}
function nextId(): string {
  paragraphCounter += 1;
  return `p${paragraphCounter}`;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Measure how far the tallest glyphs of a line reach above the baseline.
 *
 * This is a raw measurement in pixels - how large the font actually is
 * depends on the script, so it is turned into a font size later on (see
 * `normalizeFontSizes`). The tallest word of the line is used, because a
 * line without a capital still has ascenders and would otherwise be
 * measured far too small.
 */
export function measureLineAscent(line: {
  baselineY: number;
  words: { bbox: { y0: number } }[];
}): number {
  const ascents = line.words
    .map((word) => line.baselineY - word.bbox.y0)
    .filter((height) => height > 0)
    .sort((a, b) => b - a);
  if (!ascents.length) return 0;
  // the 90th percentile, so a single stray fragment cannot distort it
  const index = Math.min(ascents.length - 1, Math.floor(ascents.length * 0.1));
  return ascents[index];
}

export type ParagraphBuildInput = {
  lines: RecognizedLine[];
  /** the box the text is aligned inside (column or content width) */
  box: ContentBox;
  regionIndex: number;
  sliceIndex?: number;
  /** extra leading applied between lines, in px */
  preserveBreaks: boolean;
};

/**
 * Group recognised lines into paragraphs and derive the Word formatting
 * (alignment, indents, spacing) that reproduces the original layout.
 */
export function buildParagraphs(input: ParagraphBuildInput): ParagraphLayout[] {
  const { box, regionIndex } = input;
  const lines = [...input.lines].sort((a, b) => a.baselineY - b.baselineY || a.bbox.x0 - b.bbox.x0);
  if (!lines.length) return [];

  const boxWidth = Math.max(1, box.x1 - box.x0);

  // baseline distances between neighbouring lines
  const deltas: number[] = [];
  for (let i = 1; i < lines.length; i++) deltas.push(lines[i].baselineY - lines[i - 1].baselineY);
  const baseSpacing = deltas.length ? median(deltas) : 0;

  const widths = lines.map((l) => l.bbox.x1 - l.bbox.x0);
  const maxWidth = Math.max(...widths);

  // is the text justified? in justified text almost every line reaches the
  // right edge of the column
  const reachingRight = lines.filter((l) => box.x1 - l.bbox.x1 < boxWidth * 0.06).length;
  const justified = lines.length >= 3 && reachingRight / lines.length > 0.55;

  type Group = { lines: RecognizedLine[] };
  const groups: Group[] = [];
  let current: Group = { lines: [lines[0]] };

  for (let i = 1; i < lines.length; i++) {
    const prev = lines[i - 1];
    const line = lines[i];
    const gap = line.baselineY - prev.baselineY;
    const prevSize = measureLineAscent(prev);
    const size = measureLineAscent(line);
    const sizeJump = Math.max(prevSize, size) * 0.15;

    const prevWidth = prev.bbox.x1 - prev.bbox.x0;
    const currentWidth = line.bbox.x1 - line.bbox.x0;
    const prevEndsShort = prev.bbox.x1 < box.x1 - boxWidth * 0.08;
    const lineStartsAtLeft = line.bbox.x0 <= box.x0 + boxWidth * 0.04;
    // a line that fills the column is unlikely to be the tail of a paragraph
    const lineIsFull = currentWidth > maxWidth * 0.85;

    let isBreak = false;
    if (gap > baseSpacing * 1.5) isBreak = true;
    else if (Math.abs(size - prevSize) > sizeJump) isBreak = true;
    else if (justified && prevEndsShort && lineStartsAtLeft) isBreak = true;
    else if (!justified && prevWidth < maxWidth * 0.62 && lineStartsAtLeft && lineIsFull) {
      isBreak = true;
    }

    if (isBreak) {
      groups.push(current);
      current = { lines: [line] };
    } else {
      current.lines.push(line);
    }
  }
  groups.push(current);

  const paragraphs: ParagraphLayout[] = [];
  let previousLastBaseline: number | null = null;

  for (const group of groups) {
    const groupLines = group.lines;
    const first = groupLines[0];
    const last = groupLines[groupLines.length - 1];

    const lineLayouts: LineLayout[] = groupLines.map((line) => {
      const ascent = Math.max(0, line.baselineY - line.bbox.y0);
      const descent = Math.max(0, line.bbox.y1 - line.baselineY);
      return {
        text: line.text.trim(),
        bbox: line.bbox,
        baselineY: line.baselineY,
        words: line.words,
        fontSizePx: measureLineAscent(line),
        ascentPx: ascent,
        descentPx: descent,
      };
    });

    const fontSizePx = median(lineLayouts.map((l) => l.fontSizePx)) || baseSpacing * 0.75;

    // line spacing inside the paragraph
    let lineSpacingPx = baseSpacing;
    if (groupLines.length > 1) {
      const inner: number[] = [];
      for (let i = 1; i < groupLines.length; i++) inner.push(groupLines[i].baselineY - groupLines[i - 1].baselineY);
      lineSpacingPx = median(inner);
    } else if (baseSpacing > 0) {
      // a single line paragraph: scale the leading by the font size ratio
      lineSpacingPx = baseSpacing * (fontSizePx / (baseSpacing * 0.75 || 1));
    }

    // alignment
    const leftOffsets = lineLayouts.map((l) => l.bbox.x0 - box.x0);
    const rightOffsets = lineLayouts.map((l) => box.x1 - l.bbox.x1);
    const leftOffset = median(leftOffsets);
    const rightOffset = median(rightOffsets);
    const leftGap = leftOffset / boxWidth;
    const rightGap = rightOffset / boxWidth;

    let align: Align = "left";
    if (justified && groupLines.length > 1) align = "justify";
    else if (Math.abs(leftGap - rightGap) < 0.06 && leftGap > 0.06) align = "center";
    else if (rightGap < 0.04 && leftGap > 0.12) align = "right";

    // indents
    const bodyLeft = median(leftOffsets.slice().sort((a, b) => a - b));
    const firstLeft = leftOffsets[0];
    const indentLeftPx = Math.max(0, bodyLeft);
    const firstLineIndentPx =
      firstLeft > indentLeftPx + Math.max(2, fontSizePx * 0.25) ? firstLeft - indentLeftPx : 0;
    const indentRightPx = Math.max(0, median(rightOffsets));

    // space before the paragraph
    let spaceBeforePx = 0;
    if (previousLastBaseline !== null) {
      spaceBeforePx = Math.max(0, first.baselineY - previousLastBaseline - lineSpacingPx);
    }

    const text = groupLines.map((l) => l.text.trim()).join(" ");

    paragraphs.push({
      id: nextId(),
      text,
      originalText: text,
      bbox: {
        x0: Math.min(...lineLayouts.map((l) => l.bbox.x0)),
        y0: Math.min(...lineLayouts.map((l) => l.bbox.y0)),
        x1: Math.max(...lineLayouts.map((l) => l.bbox.x1)),
        y1: Math.max(...lineLayouts.map((l) => l.bbox.y1)),
      },
      lines: lineLayouts,
      fontSizePx,
      align,
      indentLeftPx,
      indentRightPx,
      spaceBeforePx,
      lineSpacingPx,
      regionIndex,
      sliceIndex: input.sliceIndex ?? 0,
      firstLineIndentPx,
      preserveBreaks: input.preserveBreaks,
    });

    previousLastBaseline = last.baselineY;
  }

  return paragraphs;
}

/**
 * Turn the measured ascents into real font sizes.
 *
 * The measurement itself is script independent, but the size it stands for is
 * not, so the ratio between the two depends on the script. Lines that have
 * the same size as the body text are snapped to it, which keeps a document
 * visually consistent.
 */
export function normalizeFontSizes(pages: PageLayout[], language: string): void {
  const ratio = ASCENT_RATIOS[language] ?? DEFAULT_ASCENT_RATIO;

  const metrics: number[] = [];
  for (const page of pages) {
    for (const region of page.regions) {
      for (const paragraph of region.paragraphs) {
        for (const line of paragraph.lines) {
          if (line.fontSizePx > 0) metrics.push(line.fontSizePx);
        }
      }
    }
  }
  if (!metrics.length) return;

  const sorted = [...metrics].sort((a, b) => a - b);
  const largest = sorted[sorted.length - 1];
  // stray fragments would otherwise drag the body size down
  const usable = sorted.filter((value) => value >= largest * 0.35);
  const baseSize = median(usable) / ratio;

  for (const page of pages) {
    for (const region of page.regions) {
      for (const paragraph of region.paragraphs) {
        for (const line of paragraph.lines) {
          const size = line.fontSizePx > 0 ? line.fontSizePx / ratio : baseSize;
          line.fontSizePx = Math.abs(size - baseSize) <= baseSize * 0.12 ? baseSize : size;
        }
        const sizes = paragraph.lines.map((line) => line.fontSizePx).filter((value) => value > 0);
        paragraph.fontSizePx = sizes.length ? median(sizes) : baseSize;
      }
    }
  }
}

/**
 * Re-wrap edited text so that it keeps the original line rhythm.
 * The measured widths of the original lines are used as the wrap targets.
 */
export function reflowText(text: string, lines: LineLayout[]): string[] {
  if (lines.length <= 1) return [text];
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return [""];

  // approximate the width of a single character for this paragraph
  const chars = lines.reduce((sum, l) => sum + l.text.length, 0);
  const widths = lines.map((l) => l.bbox.x1 - l.bbox.x0);
  const avgCharWidth = chars > 0 ? widths.reduce((a, b) => a + b, 0) / chars : 6;

  const result: string[] = [];
  let current = "";
  let index = 0;
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    const target = widths[Math.min(index, widths.length - 1)];
    const candidateWidth = candidate.length * avgCharWidth;
    if (current && candidateWidth > target && index < widths.length) {
      result.push(current);
      current = word;
      index++;
    } else {
      current = candidate;
    }
  }
  if (current) result.push(current);
  return result;
}
