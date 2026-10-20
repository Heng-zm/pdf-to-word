import {
  AlignmentType,
  BorderStyle,
  Column,
  Document,
  HeightRule,
  LineRuleType,
  Packer,
  Paragraph,
  SectionType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from "docx";
import type {
  DocumentLayout,
  ExportOptions,
  PageLayout,
  ParagraphLayout,
  RegionLayout,
} from "../types";
import { LANGUAGE_LOCALES } from "../types";
import { reflowText } from "../layout/paragraphs";

const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };

const ALIGNMENTS = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
  justify: AlignmentType.JUSTIFIED,
} as const;

type BuildContext = {
  scale: number;
  fontFamily: string;
  sizeRatio: number;
  preserveSpacing: boolean;
  preserveBreaks: boolean;
  boldHeadings: boolean;
  baseFontSizePt: number;
  /** the proofing language of the document, e.g. "km-KH" */
  language: string;
};

const pxToTwips = (px: number, scale: number) => Math.round(px * scale);
const pxToPt = (px: number, scale: number) => (px * scale) / 20;

function fontSizeOf(paragraph: ParagraphLayout, ctx: BuildContext): number {
  const pt = pxToPt(paragraph.fontSizePx, ctx.scale) * ctx.sizeRatio;
  return Math.max(4, Math.round(pt * 2)); // half points
}

/** A short, large paragraph is treated as a heading. */
function isHeading(paragraph: ParagraphLayout, ctx: BuildContext): boolean {
  if (paragraph.lines.length > 2) return false;
  const base = ctx.baseFontSizePt;
  const size = pxToPt(paragraph.fontSizePx, ctx.scale) * ctx.sizeRatio;
  if (size < base * 1.12) return false;
  return paragraph.text.trim().length > 0 && paragraph.text.trim().length < 120;
}

function buildParagraph(
  paragraph: ParagraphLayout,
  ctx: BuildContext,
  overrides: { spaceBeforePx?: number; spaceAfterPx?: number } = {},
): Paragraph {
  const halfPoints = fontSizeOf(paragraph, ctx);
  const bold = ctx.boldHeadings && isHeading(paragraph, ctx);
  const runOptions = {
    font: ctx.fontFamily,
    size: halfPoints,
    language: { value: ctx.language },
    ...(bold ? { bold: true } : {}),
  };

  const runs: TextRun[] = [];
  const edited = paragraph.text !== paragraph.originalText;
  const lines = paragraph.lines;

  if (ctx.preserveBreaks && lines.length > 1) {
    let pieces: string[];
    if (!edited) {
      pieces = lines.map((line) => line.text);
    } else if (paragraph.text.includes("\n")) {
      // the user kept the line structure while editing
      pieces = paragraph.text.split("\n");
    } else {
      pieces = reflowText(paragraph.text, lines);
    }
    pieces.forEach((piece, index) => {
      if (index > 0) runs.push(new TextRun({ ...runOptions, break: 1 }));
      runs.push(new TextRun({ ...runOptions, text: piece }));
    });
  } else {
    runs.push(new TextRun({ ...runOptions, text: paragraph.text }));
  }

  const spaceBeforePx = overrides.spaceBeforePx ?? paragraph.spaceBeforePx;
  const spaceAfterPx = overrides.spaceAfterPx ?? paragraph.spaceAfterPx ?? 0;

  return new Paragraph({
    children: runs,
    alignment: ALIGNMENTS[paragraph.align],
    spacing: ctx.preserveSpacing
      ? {
          before: Math.max(0, pxToTwips(spaceBeforePx, ctx.scale)),
          after: Math.max(0, pxToTwips(spaceAfterPx, ctx.scale)),
          line: Math.max(1, pxToTwips(paragraph.lineSpacingPx, ctx.scale)),
          lineRule: LineRuleType.AT_LEAST,
        }
      : { before: 0, after: 0, line: 240, lineRule: LineRuleType.AUTO },
    indent: {
      left: Math.max(0, pxToTwips(paragraph.indentLeftPx, ctx.scale)),
      right: Math.max(0, pxToTwips(paragraph.indentRightPx, ctx.scale)),
      firstLine: Math.max(0, pxToTwips(paragraph.firstLineIndentPx ?? 0, ctx.scale)),
    },
  });
}

function emptyParagraph(ctx: BuildContext): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text: "", font: ctx.fontFamily, size: 2 })],
    spacing: { before: 0, after: 0, line: 20, lineRule: LineRuleType.EXACT },
  });
}

/** Horizontal slices of a page: either full width or made up of columns. */
type Slice = {
  kind: "full" | "columns";
  regions: RegionLayout[];
  y0: number;
  y1: number;
};

function collectSlices(page: PageLayout): Slice[] {
  const byIndex = new Map<number, RegionLayout[]>();
  for (const region of page.regions) {
    const list = byIndex.get(region.sliceIndex) ?? [];
    list.push(region);
    byIndex.set(region.sliceIndex, list);
  }

  const slices: Slice[] = [];
  for (const [index, regions] of byIndex) {
    const sorted = [...regions].sort((a, b) => a.columnIndex - b.columnIndex);
    slices.push({
      kind: sorted.every((region) => region.kind === "full") ? "full" : "columns",
      regions: sorted,
      y0: Math.min(...regions.map((r) => r.bbox.y0)),
      y1: Math.max(...regions.map((r) => r.bbox.y1)),
    });
  }
  return slices.sort((a, b) => a.y0 - b.y0);
}

function firstBaseline(regions: RegionLayout[]): number | null {
  const baselines = regions
    .flatMap((region) => region.paragraphs)
    .map((paragraph) => paragraph.lines[0]?.baselineY)
    .filter((value): value is number => typeof value === "number");
  return baselines.length ? Math.min(...baselines) : null;
}

function lastBaseline(regions: RegionLayout[]): number | null {
  const baselines = regions
    .flatMap((region) => region.paragraphs)
    .map((paragraph) => paragraph.lines[paragraph.lines.length - 1]?.baselineY)
    .filter((value): value is number => typeof value === "number");
  return baselines.length ? Math.max(...baselines) : null;
}

function buildColumnTable(slice: Slice, page: PageLayout, ctx: BuildContext): Table {
  const columns = page.columns;
  const columnWidths = columns.map((column) =>
    Math.max(1, pxToTwips(column.x1 - column.x0, ctx.scale)),
  );
  const gutters = columns.slice(0, -1).map((column, index) =>
    Math.max(0, pxToTwips(columns[index + 1].x0 - column.x1 - 1, ctx.scale)),
  );
  const cellWidths = columnWidths.map((width, index) =>
    index < gutters.length ? width + gutters[index] : width,
  );

  // group the regions of this slice into rows
  const rows: RegionLayout[][] = [];
  const used = new Set<RegionLayout>();
  for (const region of slice.regions) {
    if (used.has(region)) continue;
    const row = slice.regions.filter(
      (other) =>
        !used.has(other) &&
        other.bbox.y0 >= region.bbox.y0 - 2 &&
        other.bbox.y0 <= region.bbox.y0 + 2,
    );
    row.forEach((item) => used.add(item));
    rows.push(row);
  }

  const tableRows = rows.map((row) => {
    const cells = columns.map((column, index) => {
      const region = row.find((item) => item.columnIndex === index);
      const children = region
        ? region.paragraphs.map((paragraph) => buildParagraph(paragraph, ctx))
        : [emptyParagraph(ctx)];

      return new TableCell({
        children: children.length ? children : [emptyParagraph(ctx)],
        width: { size: cellWidths[index], type: WidthType.DXA },
        margins: {
          top: 0,
          bottom: 0,
          left: 0,
          right: index < gutters.length ? gutters[index] : 0,
        },
        verticalAlign: VerticalAlign.TOP,
        borders: {
          top: NO_BORDER,
          bottom: NO_BORDER,
          left: NO_BORDER,
          right: NO_BORDER,
        },
      });
    });

    const height = Math.max(1, pxToTwips(slice.y1 - slice.y0, ctx.scale));
    return new TableRow({
      children: cells,
      height: { value: height, rule: HeightRule.ATLEAST },
    });
  });

  return new Table({
    width: { size: cellWidths.reduce((sum, width) => sum + width, 0), type: WidthType.DXA },
    columnWidths: cellWidths,
    layout: TableLayoutType.FIXED,
    borders: {
      top: NO_BORDER,
      bottom: NO_BORDER,
      left: NO_BORDER,
      right: NO_BORDER,
      insideHorizontal: NO_BORDER,
      insideVertical: NO_BORDER,
    },
    rows: tableRows,
  });
}

/** Flatten a page into a single reading order (used by the `single` mode). */
function flattenPage(page: PageLayout): RegionLayout[] {
  return [...page.regions].sort((a, b) => {
    if (Math.abs(a.bbox.y0 - b.bbox.y0) > 2) return a.bbox.y0 - b.bbox.y0;
    return a.columnIndex - b.columnIndex;
  });
}

type PageElement =
  | { kind: "paragraphs"; regions: RegionLayout[]; paragraphs: Paragraph[] }
  | { kind: "table"; slice: Slice; table: Table };

function buildPageElements(page: PageLayout, ctx: BuildContext, mode: ExportOptions["columnMode"]): PageElement[] {
  const slices = collectSlices(page);
  const elements: PageElement[] = [];
  let previousLast: number | null = null;
  let previousLayouts: ParagraphLayout[] = [];

  for (const slice of slices) {
    const currentFirst = firstBaseline(slice.regions);
    const currentSpacing =
      slice.regions.flatMap((region) => region.paragraphs)[0]?.lineSpacingPx ?? 0;

    let gap = 0;
    if (previousLast !== null && currentFirst !== null) {
      gap = Math.max(0, currentFirst - previousLast - currentSpacing);
    }

    if (mode === "single") {
      // everything flows into one column, in reading order
      const regions = flattenPage(page).filter((region) => slice.regions.includes(region));
      const layouts = regions.flatMap((region) => region.paragraphs);
      const built = layouts.map((paragraph, index) =>
        buildParagraph(paragraph, ctx, index === 0 ? { spaceBeforePx: gap } : {}),
      );
      elements.push({ kind: "paragraphs", regions, paragraphs: built });
      previousLayouts = layouts;
    } else if (slice.kind === "columns") {
      const table = buildColumnTable(slice, page, ctx);
      if (gap > 0 && elements.length && previousLayouts.length) {
        const previousElement = elements[elements.length - 1];
        if (previousElement.kind === "paragraphs") {
          const source = previousLayouts[previousLayouts.length - 1];
          const built = [...previousElement.paragraphs];
          built[built.length - 1] = buildParagraph(source, ctx, {
            spaceAfterPx: (source.spaceAfterPx ?? 0) + gap,
          });
          previousElement.paragraphs = built;
        }
      }
      elements.push({ kind: "table", slice, table });
    } else {
      const layouts = slice.regions.flatMap((region) => region.paragraphs);
      const built = layouts.map((paragraph, index) =>
        buildParagraph(paragraph, ctx, index === 0 ? { spaceBeforePx: gap } : {}),
      );
      elements.push({ kind: "paragraphs", regions: slice.regions, paragraphs: built });
      previousLayouts = layouts;
    }

    previousLast = lastBaseline(slice.regions) ?? previousLast;
  }

  return elements;
}

function buildNativeColumnSection(
  slice: Slice,
  page: PageLayout,
  ctx: BuildContext,
): {
  children: Paragraph[];
  column: {
    count: number;
    space: number;
    equalWidth: boolean;
    children: Column[];
  };
} {
  const columns = page.columns;
  const columnWidths = columns.map((column) =>
    Math.max(1, pxToTwips(column.x1 - column.x0, ctx.scale)),
  );
  const spaces = columns.slice(0, -1).map((column, index) =>
    Math.max(0, pxToTwips(columns[index + 1].x0 - column.x1 - 1, ctx.scale)),
  );

  const children = slice.regions.flatMap((region) =>
    region.paragraphs.map((paragraph) => buildParagraph(paragraph, ctx)),
  );

  return {
    children: children.length ? children : [emptyParagraph(ctx)],
    column: {
      count: columns.length,
      space: spaces.length ? spaces[0] : 720,
      equalWidth: false,
      children: columns.map((column, index) =>
        new Column({
          width: columnWidths[index],
          space: index < spaces.length ? spaces[index] : 0,
        }),
      ),
    },
  };
}

/** Build the .docx for a layout model. */
export async function buildDocx(
  layout: DocumentLayout,
  options: ExportOptions,
): Promise<Buffer> {
  const detectedBase = layout.baseFontSizePt || 11;
  const sizeRatio = options.fontSizePt ? options.fontSizePt / detectedBase : 1;

  const ctx: BuildContext = {
    scale: layout.scale,
    fontFamily: options.fontFamily || layout.fontFamily,
    sizeRatio,
    preserveSpacing: options.preserveSpacing,
    preserveBreaks: options.preserveBreaks,
    boldHeadings: false,
    baseFontSizePt: options.fontSizePt ?? detectedBase,
    language: LANGUAGE_LOCALES[layout.language] ?? "en-US",
  };

  const mode: ExportOptions["columnMode"] =
    options.columnMode === "auto"
      ? layout.maxColumns > 1
        ? "table"
        : "single"
      : options.columnMode;

  const sections: {
    properties: Record<string, unknown>;
    children: (Paragraph | Table)[];
  }[] = [];

  layout.pages.forEach((page, pageIndex) => {
    const pageProperties = {
      size: { width: layout.pageWidth, height: layout.pageHeight },
      margin: {
        top: layout.marginTop,
        right: layout.marginRight,
        bottom: layout.marginBottom,
        left: layout.marginLeft,
        header: 0,
        footer: 0,
        gutter: 0,
      },
    };

    if (mode === "native" && page.columns.length > 1) {
      // every horizontal slice becomes its own section so that a heading can
      // span the page while the text below uses real Word columns
      const slices = collectSlices(page);
      slices.forEach((slice, sliceIndex) => {
        const startsPage = pageIndex > 0 && sliceIndex === 0;
        const type = startsPage ? SectionType.NEXT_PAGE : SectionType.CONTINUOUS;
        const children: (Paragraph | Table)[] = [];

        if (slice.kind === "columns") {
          const native = buildNativeColumnSection(slice, page, ctx);
          children.push(...native.children);
          sections.push({
            properties: { type, page: pageProperties, column: native.column },
            children,
          });
        } else {
          slice.regions.forEach((region) => {
            region.paragraphs.forEach((paragraph) => {
              children.push(buildParagraph(paragraph, ctx));
            });
          });
          sections.push({ properties: { type, page: pageProperties }, children });
        }
      });
      return;
    }

    const children: (Paragraph | Table)[] = [];
    const elements = buildPageElements(page, ctx, mode);
    for (const element of elements) {
      if (element.kind === "paragraphs") children.push(...element.paragraphs);
      else children.push(element.table);
    }

    sections.push({
      properties: {
        ...(pageIndex === 0 ? {} : { type: SectionType.NEXT_PAGE }),
        page: pageProperties,
      },
      children,
    });
  });

  const document = new Document({
    creator: "ORC - OCR to editable DOCX",
    title: "Converted document",
    description: "Recognised text with the original layout reproduced",
    styles: {
      default: {
        document: {
          run: { font: ctx.fontFamily, size: Math.round((options.fontSizePt ?? detectedBase) * 2) },
          paragraph: { spacing: { before: 0, after: 0, line: 240, lineRule: LineRuleType.AUTO } },
        },
      },
    },
    sections,
  });

  return Packer.toBuffer(document);
}
