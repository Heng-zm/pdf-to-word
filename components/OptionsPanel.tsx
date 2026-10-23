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
    <div className="options-panel-inner">
      <div className="options-section">
        <div className="section-header">
          <span className="section-badge">01</span>
          <div>
            <p className="section-title">Scan &amp; Detection</p>
            <span className="section-subtitle">Image preprocessing and column analysis</span>
          </div>
        </div>

        <div className="field">
          <label htmlFor="lang">
            <span>Recognition language</span>
            <span className="field-hint">OCR Model</span>
          </label>
          <div className="select-wrap">
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
            <div className="select-arrow" />
          </div>
          <div className="desc">Local models are used instantly; others download on first use.</div>
        </div>

        <div className="row">
          <div className="field">
            <label htmlFor="scale">
              <span>PDF resolution</span>
            </label>
            <div className="select-wrap">
              <select
                id="scale"
                value={ocr.pdfScale}
                disabled={disabled}
                onChange={(event) => onOcrChange({ ...ocr, pdfScale: Number(event.target.value) })}
                title="Resolution used when rasterising a PDF"
              >
                <option value={1.5}>108 dpi (Fast)</option>
                <option value={2}>144 dpi (Default)</option>
                <option value={3}>216 dpi (Crisp)</option>
                <option value={4}>288 dpi (Ultra)</option>
              </select>
              <div className="select-arrow" />
            </div>
          </div>

          <div className="field">
            <label htmlFor="cols">
              <span>Columns</span>
            </label>
            <div className="select-wrap">
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
                <option value="auto">Auto ({detectedColumns || 1} detected)</option>
                <option value="1">1 Column (Flat)</option>
                <option value="2">2 Columns</option>
                <option value="3">3 Columns</option>
                <option value="4">4 Columns</option>
              </select>
              <div className="select-arrow" />
            </div>
          </div>
        </div>

        <div className="toggle-list">
          <label className="switch-card">
            <div className="switch-info">
              <span className="switch-title">Binarise image</span>
              <span className="switch-desc">High contrast threshold for faint or uneven scans</span>
            </div>
            <div className="switch-control">
              <input
                type="checkbox"
                checked={ocr.binarize}
                disabled={disabled}
                onChange={(event) => onOcrChange({ ...ocr, binarize: event.target.checked })}
              />
              <span className="switch-slider" />
            </div>
          </label>

          <label className="switch-card">
            <div className="switch-info">
              <span className="switch-title">Auto-straighten page</span>
              <span className="switch-desc">Deskew tilted scan angles automatically</span>
            </div>
            <div className="switch-control">
              <input
                type="checkbox"
                checked={ocr.deskew}
                disabled={disabled}
                onChange={(event) => onOcrChange({ ...ocr, deskew: event.target.checked })}
              />
              <span className="switch-slider" />
            </div>
          </label>
        </div>
      </div>

      <div className="options-divider" />

      <div className="options-section">
        <div className="section-header">
          <span className="section-badge">02</span>
          <div>
            <p className="section-title">DOCX Typography &amp; Export</p>
            <span className="section-subtitle">Typography, page setup and spacing rules</span>
          </div>
        </div>

        <div className="field">
          <label htmlFor="font">
            <span>Typeface</span>
            <span className="field-hint">Font Family</span>
          </label>
          <div className="select-wrap">
            <select
              id="font"
              value={exportOptions.fontFamily ?? ""}
              onChange={(event) => onExportChange({ ...exportOptions, fontFamily: event.target.value })}
            >
              <option value="">Auto (Best fit for script)</option>
              {FONTS.map((font) => (
                <option key={font} value={font}>
                  {font}
                </option>
              ))}
            </select>
            <div className="select-arrow" />
          </div>
          <div className="desc">
            Choosing a script-compatible font prevents missing glyph boxes in Word.
          </div>
        </div>

        <div className="row">
          <div className="field">
            <label htmlFor="size">
              <span>Base font size</span>
            </label>
            <div className="input-wrap">
              <input
                id="size"
                type="number"
                min={5}
                max={48}
                step={0.5}
                placeholder="Auto (measured)"
                value={exportOptions.fontSizePt ?? ""}
                onChange={(event) =>
                  onExportChange({
                    ...exportOptions,
                    fontSizePt: event.target.value === "" ? null : Number(event.target.value),
                  })
                }
              />
              <span className="input-unit">pt</span>
            </div>
          </div>

          <div className="field">
            <label htmlFor="pagesize">
              <span>Page size</span>
            </label>
            <div className="select-wrap">
              <select
                id="pagesize"
                value={exportOptions.pageSize}
                onChange={(event) =>
                  onExportChange({ ...exportOptions, pageSize: event.target.value as PageSizeName })
                }
              >
                <option value="auto">Match scan</option>
                <option value="a4">A4 (210×297mm)</option>
                <option value="letter">Letter (8.5×11in)</option>
                <option value="legal">Legal (8.5×14in)</option>
              </select>
              <div className="select-arrow" />
            </div>
          </div>
        </div>

        <div className="field">
          <label htmlFor="colmode">
            <span>Column handling mode</span>
          </label>
          <div className="select-wrap">
            <select
              id="colmode"
              value={exportOptions.columnMode}
              onChange={(event) =>
                onExportChange({ ...exportOptions, columnMode: event.target.value as ColumnMode })
              }
            >
              <option value="auto">Automatic (Table for multi-column)</option>
              <option value="table">Fixed borderless table — exact gutter match</option>
              <option value="native">Word columns — reflowable magazine layout</option>
              <option value="single">Single column — continuous text stream</option>
            </select>
            <div className="select-arrow" />
          </div>
        </div>

        <div className="toggle-list">
          <label className="switch-card">
            <div className="switch-info">
              <span className="switch-title">Preserve measured spacing</span>
              <span className="switch-desc">Keep original line height &amp; paragraph gaps</span>
            </div>
            <div className="switch-control">
              <input
                type="checkbox"
                checked={exportOptions.preserveSpacing}
                onChange={(event) =>
                  onExportChange({ ...exportOptions, preserveSpacing: event.target.checked })
                }
              />
              <span className="switch-slider" />
            </div>
          </label>

          <label className="switch-card">
            <div className="switch-info">
              <span className="switch-title">Keep line breaks</span>
              <span className="switch-desc">Retain source line endings inside paragraphs</span>
            </div>
            <div className="switch-control">
              <input
                type="checkbox"
                checked={exportOptions.preserveBreaks}
                onChange={(event) =>
                  onExportChange({ ...exportOptions, preserveBreaks: event.target.checked })
                }
              />
              <span className="switch-slider" />
            </div>
          </label>
        </div>
      </div>
    </div>
  );
}
