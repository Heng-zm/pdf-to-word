"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ColumnMode, ExportOptions, ModelQuality, OcrOptions, PageSizeName } from "@/lib/types";

type Props = {
  ocr: OcrOptions;
  onOcrChange: (next: OcrOptions) => void;
  exportOptions: ExportOptions;
  onExportChange: (next: ExportOptions) => void;
  disabled: boolean;
  detectedColumns: number;
};

type AvailableModel = {
  name: string;
  label: string;
  sizeBytes: number;
  isCustom: boolean;
  filename: string;
};

const STANDARD_LANGUAGES: [string, string][] = [
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
];

const POPULAR_COMBOS = [
  { label: "English + German", value: "eng+deu" },
  { label: "Khmer + English", value: "khm+eng" },
  { label: "English + French", value: "eng+fra" },
  { label: "Spanish + English", value: "spa+eng" },
  { label: "Chinese + English", value: "chi_sim+eng" },
  { label: "Japanese + English", value: "jpn+eng" },
  { label: "Arabic + English", value: "ara+eng" },
];

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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function OptionsPanel({
  ocr,
  onOcrChange,
  exportOptions,
  onExportChange,
  disabled,
  detectedColumns,
}: Props) {
  const [modelTab, setModelTab] = useState<"preset" | "combo" | "upload">(() => {
    if (ocr.langs.includes("+")) return "combo";
    return "preset";
  });
  const [models, setModels] = useState<AvailableModel[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const fetchModels = useCallback(async () => {
    try {
      const res = await fetch("/api/models");
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.models)) {
          setModels(data.models);
        }
      }
    } catch {
      /* ignore fetch error */
    }
  }, []);

  useEffect(() => {
    fetchModels();
  }, [fetchModels]);

  const handleUploadModel = async (file: File) => {
    if (!file.name.endsWith(".traineddata") && !file.name.endsWith(".traineddata.gz")) {
      setUploadStatus({
        type: "error",
        text: "Please select a .traineddata or .traineddata.gz file.",
      });
      return;
    }

    setUploading(true);
    setUploadStatus(null);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/models", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to upload model.");
      }

      setUploadStatus({
        type: "success",
        text: `Model "${data.model.name}" installed and activated!`,
      });
      await fetchModels();
      onOcrChange({ ...ocr, langs: data.model.name });
    } catch (err) {
      setUploadStatus({
        type: "error",
        text: err instanceof Error ? err.message : "Upload failed.",
      });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDeleteModel = async (filename: string, modelName: string) => {
    try {
      const res = await fetch(`/api/models?filename=${encodeURIComponent(filename)}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setUploadStatus({
          type: "success",
          text: `Model "${modelName}" removed.`,
        });
        await fetchModels();
        if (ocr.langs === modelName) {
          onOcrChange({ ...ocr, langs: "eng" });
        }
      } else {
        const data = await res.json();
        setUploadStatus({ type: "error", text: data.error || "Failed to delete model." });
      }
    } catch (err) {
      setUploadStatus({
        type: "error",
        text: err instanceof Error ? err.message : "Delete failed.",
      });
    }
  };

  const customModels = models.filter((m) => m.isCustom);
  const activeLangs = ocr.langs.split("+").map((s) => s.trim().toLowerCase());

  return (
    <div className="options-panel-inner">
      <div className="options-section">
        <div className="section-header">
          <span className="section-badge">01</span>
          <div>
            <p className="section-title">Scan &amp; OCR Model</p>
            <span className="section-subtitle">Tesseract model management &amp; preprocessing</span>
          </div>
        </div>

        {/* Model Quality segmented control */}
        <div className="field">
          <label>
            <span>Model Quality</span>
            <span className="field-hint">Accuracy vs Speed</span>
          </label>
          <div className="model-quality-row" role="group" aria-label="Model Quality">
            <button
              type="button"
              disabled={disabled}
              aria-pressed={ocr.modelQuality === "best"}
              onClick={() => onOcrChange({ ...ocr, modelQuality: "best" })}
              title="4.0.0_best_int: Maximum recognition accuracy"
            >
              ⭐ Best (High Acc)
            </button>
            <button
              type="button"
              disabled={disabled}
              aria-pressed={ocr.modelQuality === "fast"}
              onClick={() => onOcrChange({ ...ocr, modelQuality: "fast" })}
              title="4.0.0_fast: Faster inference, 1/3 size"
            >
              ⚡ Fast (Speed)
            </button>
            <button
              type="button"
              disabled={disabled}
              aria-pressed={ocr.modelQuality === "standard"}
              onClick={() => onOcrChange({ ...ocr, modelQuality: "standard" })}
              title="4.0.0: Standard baseline model"
            >
              Standard
            </button>
          </div>
        </div>

        {/* Model Tabs */}
        <div className="field">
          <label>
            <span>Language &amp; Model</span>
            <span className="field-hint">Active: {ocr.langs}</span>
          </label>

          <div className="model-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-pressed={modelTab === "preset"}
              onClick={() => setModelTab("preset")}
            >
              Presets
            </button>
            <button
              type="button"
              role="tab"
              aria-pressed={modelTab === "combo"}
              onClick={() => setModelTab("combo")}
            >
              Multi-Lang
            </button>
            <button
              type="button"
              role="tab"
              aria-pressed={modelTab === "upload"}
              onClick={() => setModelTab("upload")}
            >
              Upload Model {customModels.length > 0 && `(${customModels.length})`}
            </button>
          </div>

          {/* TAB 1: Presets */}
          {modelTab === "preset" && (
            <div className="select-wrap">
              <select
                id="lang"
                value={ocr.langs}
                disabled={disabled}
                onChange={(event) => onOcrChange({ ...ocr, langs: event.target.value })}
              >
                <optgroup label="Standard Languages">
                  {STANDARD_LANGUAGES.map(([code, label]) => (
                    <option key={code} value={code}>
                      {label} ({code})
                    </option>
                  ))}
                </optgroup>
                {customModels.length > 0 && (
                  <optgroup label="Custom Installed Models">
                    {customModels.map((m) => (
                      <option key={m.name} value={m.name}>
                        {m.label} ({formatBytes(m.sizeBytes)})
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
              <div className="select-arrow" />
            </div>
          )}

          {/* TAB 2: Multi-Language Combo */}
          {modelTab === "combo" && (
            <div>
              <div className="input-wrap">
                <input
                  type="text"
                  placeholder="e.g. eng+deu or khm+eng"
                  value={ocr.langs}
                  disabled={disabled}
                  onChange={(e) => onOcrChange({ ...ocr, langs: e.target.value.trim() })}
                />
              </div>
              <div className="combo-chips">
                {POPULAR_COMBOS.map((combo) => (
                  <button
                    key={combo.value}
                    type="button"
                    className={`chip-btn ${ocr.langs === combo.value ? "active" : ""}`}
                    onClick={() => onOcrChange({ ...ocr, langs: combo.value })}
                  >
                    + {combo.value}
                  </button>
                ))}
              </div>
              <div className="desc" style={{ marginTop: 6 }}>
                Combine codes with &quot;+&quot;. Tesseract simultaneously evaluates all specified languages.
              </div>
            </div>
          )}

          {/* TAB 3: Upload Custom Model */}
          {modelTab === "upload" && (
            <div>
              <div
                className="model-upload-zone"
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (e.dataTransfer.files?.[0]) {
                    handleUploadModel(e.dataTransfer.files[0]);
                  }
                }}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".traineddata,.gz"
                  disabled={disabled || uploading}
                  onChange={(e) => {
                    if (e.target.files?.[0]) {
                      handleUploadModel(e.target.files[0]);
                    }
                  }}
                />
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                <span style={{ fontSize: 12, fontWeight: 600 }}>
                  {uploading ? "Installing model into runtime..." : "Drop .traineddata / .gz here"}
                </span>
                <span style={{ fontSize: 11, color: "var(--ink-tertiary)" }}>
                  Click to browse from disk (Max 120 MB)
                </span>
              </div>

              {uploadStatus && (
                <div className={`model-feedback ${uploadStatus.type}`}>{uploadStatus.text}</div>
              )}

              {/* Uploaded models list */}
              <div className="custom-models-list">
                <span style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-secondary)" }}>
                  Installed Custom Models:
                </span>
                {customModels.length === 0 ? (
                  <div className="model-empty">No custom models uploaded yet.</div>
                ) : (
                  customModels.map((m) => {
                    const isActive = activeLangs.includes(m.name);
                    return (
                      <div key={m.filename} className="custom-model-card">
                        <div>
                          <span className="name">{m.name}</span>
                          <span className="size">({formatBytes(m.sizeBytes)})</span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          {isActive ? (
                            <span className="badge-active">Active</span>
                          ) : (
                            <button
                              type="button"
                              className="btn-activate"
                              onClick={() => onOcrChange({ ...ocr, langs: m.name })}
                              title="Set as active recognition model"
                            >
                              Activate
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn-icon-danger"
                            onClick={() => handleDeleteModel(m.filename, m.name)}
                            title="Delete custom model"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <polyline points="3 6 5 6 21 6" />
                              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* Fallback hidden select for scripts if on another tab */}
          {modelTab !== "preset" && (
            <select
              id="lang"
              value={ocr.langs}
              style={{ display: "none" }}
              disabled={disabled}
              onChange={(e) => onOcrChange({ ...ocr, langs: e.target.value })}
            >
              <option value={ocr.langs}>{ocr.langs}</option>
            </select>
          )}

          <div className="desc" style={{ marginTop: 6 }}>
            Models are automatically cached in safe ephemeral storage for instant re-runs.
          </div>
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
