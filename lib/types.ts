/**
 * Shared layout model.
 *
 * This is the single contract between three stages:
 *   1. OCR      -> produces `DocumentLayout` from pixels
 *   2. Editor   -> mutates `DocumentLayout` in the browser
 *   3. Export   -> turns `DocumentLayout` into a .docx
 *
 * Geometry is stored in *page pixels* (the coordinate space of the rendered
 * page image). The exporter converts pixels -> twips using the page scale so
 * that spacing survives the trip into Word.
 */

export type BBox = { x0: number; y0: number; x1: number; y1: number };

export type WordLayout = {
  text: string;
  bbox: BBox;
  confidence: number;
};

export type LineLayout = {
  text: string;
  bbox: BBox;
  /** y of the baseline in page pixels */
  baselineY: number;
  words: WordLayout[];
  /** estimated font size in page pixels */
  fontSizePx: number;
  /** distance from baseline up to the top of the tallest glyph */
  ascentPx: number;
  /** distance from baseline down to the bottom of the deepest descender */
  descentPx: number;
};

export type Align = "left" | "center" | "right" | "justify";

export type ParagraphLayout = {
  id: string;
  /** text as shown in the editor (may differ from the OCR'd lines) */
  text: string;
  /** the text exactly as OCR'd it - used to detect user edits */
  originalText: string;
  bbox: BBox;
  lines: LineLayout[];
  fontSizePx: number;
  align: Align;
  /** left edge of the text relative to its column, in px */
  indentLeftPx: number;
  /** right edge offset relative to its column, in px */
  indentRightPx: number;
  /** extra space above the paragraph, in px */
  spaceBeforePx: number;
  /** extra space below the paragraph, in px */
  spaceAfterPx?: number;
  /** baseline-to-baseline distance inside the paragraph, in px */
  lineSpacingPx: number;
  /** index of the region this paragraph belongs to */
  regionIndex: number;
  /** index of the horizontal slice (row) this region belongs to */
  sliceIndex: number;
  /** indent of the first line relative to the body indent, in px */
  firstLineIndentPx?: number;
  /** user-toggled: keep the original line breaks */
  preserveBreaks: boolean;
  /** user-toggled: force bold */
  bold?: boolean;
};

export type RegionLayout = {
  /** `full` spans the whole content width, `column` belongs to one column */
  kind: "full" | "column";
  /** index into `PageLayout.columns`, -1 for full-width regions */
  columnIndex: number;
  /** index of the horizontal slice (row) this region belongs to */
  sliceIndex: number;
  bbox: BBox;
  paragraphs: ParagraphLayout[];
};

export type ColumnLayout = {
  x0: number;
  x1: number;
};

export type PageLayout = {
  index: number;
  widthPx: number;
  heightPx: number;
  /** content columns detected on this page (page pixels) */
  columns: ColumnLayout[];
  regions: RegionLayout[];
  /** data-url preview of the rendered page */
  image?: string;
};

export type PageSizeName = "auto" | "a4" | "letter" | "legal";

export type ColumnMode = "auto" | "table" | "native" | "single";

export type ExportOptions = {
  /** the typeface, or null to use the one that fits the script */
  fontFamily: string | null;
  /** override the detected base font size, in points */
  fontSizePt?: number | null;
  columnMode: ColumnMode;
  pageSize: PageSizeName;
  /** keep measured line spacing / space-before values */
  preserveSpacing: boolean;
  /** keep the original line breaks inside each paragraph */
  preserveBreaks: boolean;
};

export type ModelQuality = "best" | "fast" | "standard";

export type OcrOptions = {
  langs: string;
  modelQuality: ModelQuality;
  /** render scale for PDFs (2 = 144 dpi) */
  pdfScale: number;
  /** maximum long edge of an uploaded image in px before OCR */
  maxImageEdge: number;
  /** deskew the page before OCR */
  deskew: boolean;
  /** binarise the page before OCR */
  binarize: boolean;
  /** force a column count instead of auto-detecting */
  forceColumns: number | null;
};

export type DocumentLayout = {
  pages: PageLayout[];
  /** page size in twips */
  pageWidth: number;
  pageHeight: number;
  /** margins in twips */
  marginTop: number;
  marginRight: number;
  marginBottom: number;
  marginLeft: number;
  /** dominant body font size in points */
  baseFontSizePt: number;
  /** pixels -> twips */
  scale: number;
  fontFamily: string;
  /** highest number of columns detected on any page */
  maxColumns: number;
  language: string;
};

export type OcrProgress =
  | { type: "status"; stage: string; message: string }
  | { type: "page"; page: number; pages: number; stage: string }
  | { type: "result"; layout: DocumentLayout }
  | { type: "error"; message: string };

export const DEFAULT_OCR_OPTIONS: OcrOptions = {
  langs: "eng",
  modelQuality: "best",
  pdfScale: 2,
  maxImageEdge: 2600,
  deskew: false,
  binarize: false,
  forceColumns: null,
};

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  fontFamily: "Calibri",
  fontSizePt: null,
  columnMode: "auto",
  pageSize: "auto",
  preserveSpacing: true,
  preserveBreaks: true,
};

export const PAGE_SIZES_TWIPS: Record<Exclude<PageSizeName, "auto">, { w: number; h: number }> = {
  a4: { w: 11906, h: 16838 },
  letter: { w: 12240, h: 15840 },
  legal: { w: 12240, h: 20160 },
};

/**
 * A font that can actually render the script of a language.
 *
 * Latin typefaces do not contain Khmer, Lao, Thai, CJK or Arabic glyphs, so
 * the exported document would show empty boxes if the default typeface was
 * used. The default font follows the selected language until the user picks
 * a typeface of their own.
 */
export const LANGUAGE_FONTS: Record<string, string> = {
  khm: "Khmer OS Battambang",
  mya: "Myanmar Sans Pro",
  tha: "Leelawadee UI",
  lao: "DokChampa",
  ara: "Arial",
  heb: "Arial",
  hin: "Nirmala UI",
  mar: "Nirmala UI",
  nep: "Nirmala UI",
  pan: "Nirmala UI",
  sin: "Iskoola Pota",
  chi_sim: "Microsoft YaHei",
  chi_tra: "Microsoft JhengHei",
  jpn: "Yu Gothic",
  kor: "Malgun Gothic",
  ell: "Arial",
  rus: "Arial",
  ukr: "Arial",
};

/** Font stacks used for the on screen preview, per script. */export const PREVIEW_FONT_STACKS: Record<string, string> = {
  khm: '"Khmer OS Battambang", "Noto Sans Khmer", "Noto Sans Khmer UI", DaunPenh, MoolBoran, sans-serif',
  mya: '"Myanmar Sans Pro", "Noto Sans Myanmar", Padauk, sans-serif',
  tha: '"Leelawadee UI", "Noto Sans Thai", Tahoma, sans-serif',
  lao: '"DokChampa", "Noto Sans Lao", sans-serif',
  ara: '"Arial", "Segoe UI", "Noto Naskh Arabic", sans-serif',
  hin: '"Nirmala UI", "Noto Sans Devanagari", sans-serif',
  chi_sim: '"Microsoft YaHei", "Noto Sans SC", sans-serif',
  chi_tra: '"Microsoft JhengHei", "Noto Sans TC", sans-serif',
  jpn: '"Yu Gothic", "Noto Sans JP", sans-serif',
  kor: '"Malgun Gothic", "Noto Sans KR", sans-serif',
};

/**
 * How far the tallest glyphs of a line reach above the baseline, as a
 * fraction of the font size.
 *
 * Latin text reaches roughly the ascender height, but scripts with tall
 * combining marks reach much further: a Khmer vowel sign can sit a full em
 * above the baseline, so the same measurement means a different font size.
 */
export const ASCENT_RATIOS: Record<string, number> = {
  khm: 1.1,
  mya: 1.05,
  tha: 0.85,
  lao: 0.85,
  jpn: 0.88,
  kor: 0.88,
  chi_sim: 0.88,
  chi_tra: 0.88,
  ara: 0.78,
  hin: 0.9,
};

export const DEFAULT_ASCENT_RATIO = 0.74;

/** The proofing language written into the document, per Tesseract language. */
export const LANGUAGE_LOCALES: Record<string, string> = {
  eng: "en-US",
  deu: "de-DE",
  fra: "fr-FR",
  spa: "es-ES",
  ita: "it-IT",
  por: "pt-BR",
  nld: "nl-NL",
  pol: "pl-PL",
  rus: "ru-RU",
  ukr: "uk-UA",
  tur: "tr-TR",
  ara: "ar-SA",
  heb: "he-IL",
  hin: "hi-IN",
  khm: "km-KH",
  mya: "my-MM",
  tha: "th-TH",
  lao: "lo-LA",
  chi_sim: "zh-CN",
  chi_tra: "zh-TW",
  jpn: "ja-JP",
  kor: "ko-KR",
  vie: "vi-VN",
};
