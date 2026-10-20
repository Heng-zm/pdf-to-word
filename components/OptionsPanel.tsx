"use client";

import type { ColumnMode, ExportOptions, OcrOptions, PageSizeName } from "@/lib/types";

type Props = {
  ocr: OcrOptions;
  onOcrChange: (next: OcrOptions) => void;
  exportOptions: ExportOptions;
  onExportChange: (next: ExportOptions) => void;
  disabled: boolean;
  detectedColumns: number;
};

const LANGUAGES = [
  ["eng", "English"],
  ["deu", "German"],
  ["fra", "French"],
  ["spa", "Spanish"],
  ["ita", "Italian"],
  ["por", "Portuguese"],
  ["nld", "Dutch"],
  ["pol", "Polish"],
  ["rus", "Russian"],
  ["ukr", "Ukrainian"],
  ["tur", "Turkish"],
  ["ara", "Arabic"],
  ["hin", "Hindi"],
  ["khm", "Khmer"],
  ["mya", "Burmese"],
  ["tha", "Thai"],
  ["lao", "Lao"],
  ["chi_sim", "Chinese (simplified)"],
  ["chi_tra", "Chinese (traditional)"],
  ["jpn", "Japanese"],
  ["kor", "Korean"],
  ["vie", "Vietnamese"],
] as const;

const FONTS = [
  "Calibri",
  "Arial",
  "Helvetica",
  "Times New Roman",
  "Georgia",
  "Verdana",
  "Tahoma",
  "Courier New",
  "Segoe UI",
  "Garamond",
  "Cambria",
  "Khmer OS Battambang",
  "Noto Sans Khmer",
  "Noto Serif Khmer",
  "DaunPenh",
  "MoolBoran",
  "Noto Sans Myanmar",
  "Leelawadee UI",
  "Nirmala UI",
  "Microsoft YaHei",
  "Microsoft JhengHei",
  "Yu Gothic",
  "Malgun Gothic",
];

export function OptionsPanel({
  ocr,
  onOcrChange,
  exportOptions,
  onExportChange,
  disabled,
  detectedColumns,
}: Props) {
  return (
    <>
      <p className="section-title">Source</p>
      <div className="field">
        <label htmlFor="lang">Recognition language</label>
        <select
          id="lang"
          value={ocr.langs}
          disabled={disabled}
          onChange={(event) => onOcrChange({ ...ocr, langs: event.target.value })}
        >
          {LANGUAGES.map(([code, label]) => (
            <option key={code} value={code}>
              {label}
            </option>
          ))}
        </select>
        <div className="desc">The language data is downloaded on first use.</div>
      </div>

      <div className="row">
        <div className="field">
          <label htmlFor="scale">PDF resolution</label>
          <select
            id="scale"
            value={ocr.pdfScale}
            disabled={disabled}
            onChange={(event) => onOcrChange({ ...ocr, pdfScale: Number(event.target.value) })}
            title="Resolution used when rasterising a PDF"
          >
            <option value={1.5}>108 dpi</option>
            <option value={2}>144 dpi</option>
            <option value={3}>216 dpi</option>
            <option value={4}>288 dpi</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="cols">Columns</label>
          <select
            id="cols"
            value={ocr.forceColumns ?? "auto"}
            disabled={disabled}
            onChange={(event) =>
              onOcrChange({
                ...ocr,
                forceColumns: event.target.value === "auto" ? null : Number(event.target.value),
              })
            }
          >
            <option value="auto">Auto ({detectedColumns || 1} found)</option>
            <option value="1">Single column</option>
            <option value="2">Two columns</option>
            <option value="3">Three columns</option>
            <option value="4">Four columns</option>
          </select>
        </div>
      </div>

      <label className="check">
        <input
          type="checkbox"
          checked={ocr.binarize}
          disabled={disabled}
          onChange={(event) => onOcrChange({ ...ocr, binarize: event.target.checked })}
        />
        <span>
          Binarise before recognising
          <small>Helps with faint or unevenly lit scans.</small>
        </span>
      </label>

      <label className="check">
        <input
          type="checkbox"
          checked={ocr.deskew}
          disabled={disabled}
          onChange={(event) => onOcrChange({ ...ocr, deskew: event.target.checked })}
        />
        <span>
          Straighten the page
          <small>Corrects a slight rotation of a photo or scan.</small>
        </span>
      </label>

      <div className="divider" />
      <p className="section-title">Document output</p>

      <div className="field">
        <label htmlFor="font">Typeface</label>
        <select
          id="font"
          value={exportOptions.fontFamily ?? ""}
          onChange={(event) => onExportChange({ ...exportOptions, fontFamily: event.target.value })}
        >
          <option value="">Match the script</option>
          {FONTS.map((font) => (
            <option key={font} value={font}>
              {font}
            </option>
          ))}
        </select>
        <div className="desc">
          A typeface that cannot render the chosen script would show empty boxes in Word.
        </div>
      </div>

      <div className="row">
        <div className="field">
          <label htmlFor="size">Base font size</label>
          <input
            id="size"
            type="number"
            min={5}
            max={48}
            step={0.5}
            placeholder="auto"
            value={exportOptions.fontSizePt ?? ""}
            onChange={(event) =>
              onExportChange({
                ...exportOptions,
                fontSizePt: event.target.value === "" ? null : Number(event.target.value),
              })
            }
          />
        </div>
        <div className="field">
          <label htmlFor="pagesize">Page size</label>
          <select
            id="pagesize"
            value={exportOptions.pageSize}
            onChange={(event) =>
              onExportChange({ ...exportOptions, pageSize: event.target.value as PageSizeName })
            }
          >
            <option value="auto">Match the source</option>
            <option value="a4">A4</option>
            <option value="letter">Letter</option>
            <option value="legal">Legal</option>
          </select>
        </div>
      </div>

      <div className="field">
        <label htmlFor="colmode">Column handling</label>
        <select
          id="colmode"
          value={exportOptions.columnMode}
          onChange={(event) =>
            onExportChange({ ...exportOptions, columnMode: event.target.value as ColumnMode })
          }
        >
          <option value="auto">Automatic</option>
          <option value="table">Fixed table - exact gutter</option>
          <option value="native">Word columns - reflowable</option>
          <option value="single">Single column - text only</option>
        </select>
        <div className="desc">
          A fixed table reproduces the measured column gap exactly. Word columns reflow the
          text like a normal magazine layout.
        </div>
      </div>

      <label className="check">
        <input
          type="checkbox"
          checked={exportOptions.preserveSpacing}
          onChange={(event) =>
            onExportChange({ ...exportOptions, preserveSpacing: event.target.checked })
          }
        />
        <span>
          Keep measured spacing
          <small>Line height and paragraph gaps follow the original.</small>
        </span>
      </label>

      <label className="check">
        <input
          type="checkbox"
          checked={exportOptions.preserveBreaks}
          onChange={(event) =>
            onExportChange({ ...exportOptions, preserveBreaks: event.target.checked })
          }
        />
        <span>
          Keep the original line breaks
          <small>Turn off to let the text flow naturally.</small>
        </span>
      </label>
    </>
  );
}
