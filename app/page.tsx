"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Dropzone } from "@/components/Dropzone";
import { OptionsPanel } from "@/components/OptionsPanel";
import { PageCanvas } from "@/components/PageCanvas";
import { Toasts, useToasts } from "@/components/Toasts";
import { useElementWidth, useHotkey, useMediaQuery } from "@/lib/hooks";
import {
  DEFAULT_EXPORT_OPTIONS,
  DEFAULT_OCR_OPTIONS,
  LANGUAGE_FONTS,
  PREVIEW_FONT_STACKS,
  type DocumentLayout,
  type ExportOptions,
  type OcrOptions,
  type OcrProgress,
} from "@/lib/types";

type Status = "idle" | "working" | "done" | "error";

const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const MAX_UPLOAD = 40 * 1024 * 1024;

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [ocrOptions, setOcrOptions] = useState<OcrOptions>(DEFAULT_OCR_OPTIONS);
  const [exportOptions, setExportOptions] = useState<ExportOptions>(DEFAULT_EXPORT_OPTIONS);
  const [layout, setLayout] = useState<DocumentLayout | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");
  const [pageProgress, setPageProgress] = useState<{ page: number; pages: number } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showSource, setShowSource] = useState(false);
  const [showBoxes, setShowBoxes] = useState(true);
  const [view, setView] = useState<"layout" | "text">("layout");
  const [exporting, setExporting] = useState(false);
  const [fontTouched, setFontTouched] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [dragging, setDragging] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  const { toasts, push, dismiss } = useToasts();
  const isWide = useMediaQuery("(min-width: 1100px)");
  const [setScrollRef, availableWidth] = useElementWidth<HTMLDivElement>();
  const mainRef = useRef<HTMLElement | null>(null);

  const busy = status === "working";

  // Hydrate theme on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem("orc_theme") as "dark" | "light" | null;
      if (saved === "dark" || saved === "light") {
        setTheme(saved);
        document.documentElement.setAttribute("data-theme", saved);
      } else {
        document.documentElement.setAttribute("data-theme", "dark");
      }
    } catch {
      /* ignore storage unavailable */
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((current) => {
      const next = current === "dark" ? "light" : "dark";
      try {
        localStorage.setItem("orc_theme", next);
      } catch {
        /* ignore */
      }
      document.documentElement.setAttribute("data-theme", next);
      return next;
    });
  }, []);

  /**
   * Latin typefaces have no Khmer, Thai or CJK glyphs, so the typeface
   * follows the language until the user picks one themselves.
   */
  const handleOcrChange = useCallback(
    (next: OcrOptions) => {
      setOcrOptions(next);
      if (fontTouched) return;
      const recommended = LANGUAGE_FONTS[next.langs] ?? DEFAULT_EXPORT_OPTIONS.fontFamily;
      setExportOptions((current) => ({ ...current, fontFamily: recommended }));
    },
    [fontTouched],
  );

  const handleExportChange = useCallback((next: ExportOptions) => {
    setExportOptions(next);
    setFontTouched(true);
  }, []);

  const previewFont = useMemo(() => {
    const stack = PREVIEW_FONT_STACKS[ocrOptions.langs];
    const chosen = exportOptions.fontFamily || LANGUAGE_FONTS[ocrOptions.langs] || "Calibri";
    return stack ? `"${chosen}", ${stack}` : `"${chosen}", sans-serif`;
  }, [ocrOptions.langs, exportOptions.fontFamily]);

  const handleFile = useCallback(
    (next: File | null) => {
      if (next && next.size > MAX_UPLOAD) {
        push("error", "That file is larger than 40 MB. Please upload a smaller document.");
        return;
      }
      setFile(next);
    },
    [push],
  );

  const loadSample = useCallback(async () => {
    try {
      const response = await fetch("/sample.pdf");
      const blob = await response.blob();
      handleFile(new File([blob], "sample.pdf", { type: "application/pdf" }));
      push("info", "Sample loaded. Press “Recognise text” to continue.");
    } catch {
      push("error", "The sample document could not be loaded.");
    }
  }, [handleFile, push]);

  const runOcr = useCallback(async () => {
    if (!file) return;
    setStatus("working");
    setLayout(null);
    setSelectedId(null);
    setMessage("Preparing the document");
    setPageProgress(null);

    const body = new FormData();
    body.append("file", file);
    body.append("options", JSON.stringify(ocrOptions));

    try {
      const response = await fetch("/api/ocr", { method: "POST", body });
      if (!response.ok || !response.body) {
        const detail = await response.json().catch(() => null);
        throw new Error(detail?.error ?? `The server returned ${response.status}.`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const parts = buffer.split("\n");
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          if (!part.trim()) continue;
          const event = JSON.parse(part) as OcrProgress;
          if (event.type === "status") setMessage(event.message);
          else if (event.type === "page") {
            setPageProgress({ page: event.page, pages: event.pages });
            setMessage(`Reading page ${event.page} of ${event.pages}`);
          } else if (event.type === "result") {
            setLayout(event.layout);
            setStatus("done");
            setMessage("");
            setPageProgress(null);
            const pages = event.layout.pages.length;
            push("success", `Recognised ${pages} page${pages === 1 ? "" : "s"}.`);
            // on a small screen the result is below the fold, so bring it up
            if (!isWide) {
              requestAnimationFrame(() =>
                mainRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
              );
            }
          } else if (event.type === "error") {
            throw new Error(event.message);
          }
        }
      }
    } catch (cause) {
      setStatus("error");
      setMessage("");
      setPageProgress(null);
      const text = cause instanceof Error ? cause.message : "Something went wrong.";
      push("error", text);
    }
  }, [file, ocrOptions, push, isWide]);

  const handleEdit = useCallback((id: string, text: string) => {
    setLayout((current) => {
      if (!current) return current;
      return {
        ...current,
        pages: current.pages.map((page) => ({
          ...page,
          regions: page.regions.map((region) => ({
            ...region,
            paragraphs: region.paragraphs.map((paragraph) =>
              paragraph.id === id ? { ...paragraph, text } : paragraph,
            ),
          })),
        })),
      };
    });
  }, []);

  const handleToggleBold = useCallback((id: string) => {
    setLayout((current) => {
      if (!current) return current;
      return {
        ...current,
        pages: current.pages.map((page) => ({
          ...page,
          regions: page.regions.map((region) => ({
            ...region,
            paragraphs: region.paragraphs.map((paragraph) =>
              paragraph.id === id ? { ...paragraph, bold: !paragraph.bold } : paragraph,
            ),
          })),
        })),
      };
    });
  }, []);

  const handleAlignChange = useCallback(
    (id: string, align: "left" | "center" | "right" | "justify") => {
      setLayout((current) => {
        if (!current) return current;
        return {
          ...current,
          pages: current.pages.map((page) => ({
            ...page,
            regions: page.regions.map((region) => ({
              ...region,
              paragraphs: region.paragraphs.map((paragraph) =>
                paragraph.id === id ? { ...paragraph, align } : paragraph,
              ),
            })),
          })),
        };
      });
    },
    [],
  );

  const handleExport = useCallback(async () => {
    if (!layout) return;
    setExporting(true);
    try {
      const response = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ layout, options: exportOptions, filename: file?.name }),
      });
      if (!response.ok) {
        const detail = await response.json().catch(() => null);
        throw new Error(detail?.error ?? "The export failed.");
      }
      let filename = (file ? file.name.replace(/\.[^.]+$/, "") : "document") + ".docx";
      const disposition = response.headers.get("content-disposition");
      if (disposition) {
        const utfMatch = disposition.match(/filename\*=UTF-8''([^;]+)/i);
        if (utfMatch) {
          try {
            filename = decodeURIComponent(utfMatch[1]);
          } catch {
            /* keep default */
          }
        } else {
          const match = disposition.match(/filename="?([^";]+)"?/i);
          if (match) filename = match[1];
        }
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      push("success", "The Word document is ready.");
    } catch (cause) {
      push("error", cause instanceof Error ? cause.message : "The export failed.");
    } finally {
      setExporting(false);
    }
  }, [layout, exportOptions, file, push]);

  useHotkey({ key: "Enter", meta: true }, () => {
    if (file && !busy) void runOcr();
  });

  // dropping a file anywhere on the page works
  useEffect(() => {
    let depth = 0;
    const onEnter = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes("Files")) return;
      depth += 1;
      setDragging(true);
    };
    const onLeave = () => {
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onOver = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
    };
    const onDrop = (event: DragEvent) => {
      if (!event.dataTransfer?.files.length) return;
      event.preventDefault();
      depth = 0;
      setDragging(false);
      handleFile(event.dataTransfer.files[0]);
    };
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("dragover", onOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("drop", onDrop);
    };
  }, [handleFile]);

  const stats = useMemo(() => {
    if (!layout) return null;
    let paragraphs = 0;
    let words = 0;
    for (const page of layout.pages) {
      for (const region of page.regions) {
        for (const paragraph of region.paragraphs) {
          paragraphs += 1;
          words += paragraph.text.split(/\s+/).filter(Boolean).length;
        }
      }
    }
    return { paragraphs, words, pages: layout.pages.length, columns: layout.maxColumns };
  }, [layout]);

  const selected = useMemo(() => {
    if (!layout || !selectedId) return null;
    for (const page of layout.pages) {
      for (const region of page.regions) {
        const found = region.paragraphs.find((paragraph) => paragraph.id === selectedId);
        if (found) return found;
      }
    }
    return null;
  }, [layout, selectedId]);

  const zoomIndex = ZOOM_STEPS.indexOf(zoom);
  const setZoomStep = (delta: number) => {
    const next = Math.min(ZOOM_STEPS.length - 1, Math.max(0, zoomIndex + delta));
    setZoom(ZOOM_STEPS[next]);
  };

  const renderWidth = Math.max(280, Math.round((availableWidth || 820) * zoom));

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">ORC</div>
          <div className="brand-titles">
            <span className="brand-name">ORC Studio</span>
            <span className="brand-tagline">images &amp; PDF to editable Word</span>
          </div>
        </div>

        <div className="topbar-spacer" />

        {stats ? (
          <div className="telemetry-row">
            <span className="stat">
              <b>{stats.pages}</b> pages
            </span>
            <span className="stat">
              <b>{stats.words}</b> words
            </span>
            <span className="stat">
              <b>{stats.columns}</b> columns
            </span>
          </div>
        ) : null}

        <button
          className="theme-toggle-btn"
          onClick={toggleTheme}
          aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
          title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
        >
          {theme === "dark" ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="5" />
              <line x1="12" y1="1" x2="12" y2="3" />
              <line x1="12" y1="21" x2="12" y2="23" />
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
              <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
              <line x1="1" y1="12" x2="3" y2="12" />
              <line x1="21" y1="12" x2="23" y2="12" />
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
              <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          )}
        </button>

        <button
          className="btn btn-primary"
          onClick={handleExport}
          disabled={!layout || exporting}
        >
          {exporting ? <span className="spinner" /> : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          )}
          {exporting ? "Building" : "Download DOCX"}
        </button>
      </header>

      <main className="layout">
        <aside className="sidebar">
          <div className="panel">
            <div className="panel-head">
              <h2>Document</h2>
              <span className="hint">PDF or image</span>
            </div>
            <div className="panel-body">
              <Dropzone file={file} onFile={handleFile} disabled={busy} />
              <button
                className="btn btn-primary btn-block"
                style={{ marginTop: 12 }}
                onClick={runOcr}
                disabled={!file || busy}
                title="Recognise the document (Ctrl + Enter)"
              >
                {busy ? <span className="spinner" /> : null}
                {busy ? "Recognising" : "Recognise text"}
              </button>
              {busy ? (
                <>
                  <div className="progress">
                    <span
                      style={{
                        width: pageProgress
                          ? `${((pageProgress.page - 1) / pageProgress.pages) * 100}%`
                          : "12%",
                      }}
                    />
                  </div>
                  <div className="muted" style={{ marginTop: 6 }}>
                    {message}
                  </div>
                </>
              ) : null}
            </div>
          </div>

          <div className="panel" data-collapsible="true" data-open={optionsOpen || isWide}>
            <button
              className="collapse-toggle"
              aria-expanded={optionsOpen || isWide}
              onClick={() => setOptionsOpen((open) => !open)}
            >
              Options
              <svg className="chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            <div className="panel-head">
              <h2>Source &amp; output</h2>
            </div>
            <div className="panel-body">
              <OptionsPanel
                ocr={ocrOptions}
                onOcrChange={handleOcrChange}
                exportOptions={exportOptions}
                onExportChange={handleExportChange}
                disabled={busy}
                detectedColumns={layout?.maxColumns ?? 0}
              />
            </div>
          </div>
        </aside>

        <section className="main" ref={mainRef}>
          {!layout ? (
            <div className="panel">
              <div className="empty">
                <div className="empty-glow" />
                <div className="hero-icon-cluster">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="12 2 2 7 12 12 22 7 12 2" />
                    <polyline points="2 17 12 22 22 17" />
                    <polyline points="2 12 12 17 22 12" />
                  </svg>
                </div>
                <h3>Studio Document Reconstruction</h3>
                <p>
                  Upload scanned pages, high-res photos, or multi-page PDFs. The layout engine measures
                  columns, baseline geometry, and margins to build clean, fully reflowable Word documents.
                </p>

                <div className="sample-actions">
                  <button className="btn btn-primary" onClick={loadSample}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                      <line x1="12" y1="18" x2="12" y2="12" />
                      <line x1="9" y1="15" x2="15" y2="15" />
                    </svg>
                    Try the sample document
                  </button>
                </div>

                <div className="features-grid">
                  <div className="feature-pill-card">
                    <b>Column Gutter Reconstruction</b>
                    <span>Converts multi-column pages into native Word table grids without floating textboxes.</span>
                  </div>
                  <div className="feature-pill-card">
                    <b>Proportional Typography</b>
                    <span>Calibrates point sizes, line pitch and character metrics automatically.</span>
                  </div>
                  <div className="feature-pill-card">
                    <b>Zero-Cloud Local Privacy</b>
                    <span>High-precision local Tesseract models ensure sensitive pages never leave your device.</span>
                  </div>
                </div>

                <p className="muted" style={{ marginTop: 22 }}>
                  Pro tip: press <kbd>Ctrl</kbd> + <kbd>Enter</kbd> to recognise the document instantly.
                </p>
              </div>
            </div>
          ) : (
            <>
              <div className="toolbar">
                <div className="tabs">
                  <button aria-pressed={view === "layout"} onClick={() => setView("layout")}>
                    Layout
                  </button>
                  <button aria-pressed={view === "text"} onClick={() => setView("text")}>
                    Text
                  </button>
                </div>

                {view === "layout" ? (
                  <>
                    <button
                      className="btn btn-sm"
                      aria-pressed={showBoxes}
                      onClick={() => setShowBoxes((value) => !value)}
                    >
                      {showBoxes ? "Hide" : "Show"} regions
                    </button>
                    <button
                      className="btn btn-sm"
                      aria-pressed={showSource}
                      onClick={() => setShowSource((value) => !value)}
                    >
                      {showSource ? "Hide" : "Show"} original
                    </button>
                    <div className="tabs" role="group" aria-label="Zoom">
                      <button onClick={() => setZoomStep(-1)} aria-label="Zoom out">
                        −
                      </button>
                      <button onClick={() => setZoom(1)} aria-label="Fit to width">
                        {Math.round(zoom * 100)}%
                      </button>
                      <button onClick={() => setZoomStep(1)} aria-label="Zoom in">
                        +
                      </button>
                    </div>
                  </>
                ) : null}

                <div className="spacer" />
                {stats ? (
                  <span className="stat">
                    <b>{stats.paragraphs}</b> paragraphs
                  </span>
                ) : null}
              </div>

              {view === "layout" ? (
                <div className="inspector">
                  <div className="page-stack">
                    {layout.pages.map((page) => (
                      <div className="page-frame" key={page.index}>
                        <div className="page-frame-head">
                          <b>Page {page.index + 1}</b>
                          <span className="tag">
                            {page.widthPx} × {page.heightPx} px
                          </span>
                          <span className="tag">{page.columns.length || 1} columns</span>
                          <div className="spacer" />
                          <span className="muted">Click any text block to correct it</span>
                        </div>
                        <div className="canvas-scroll" ref={setScrollRef}>
                          <PageCanvas
                            page={page}
                            width={renderWidth}
                            showSource={showSource}
                            showBoxes={showBoxes}
                            fontFamily={previewFont}
                            selectedId={selectedId}
                            onSelect={setSelectedId}
                            onEdit={handleEdit}
                          />
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="inspector-side">
                    <div className="panel">
                      <div className="panel-head">
                        <h2>Selected block</h2>
                      </div>
                      <div className="panel-body">
                        {selected ? (
                          <>
                            <div className="kv">
                              <span>Font size</span>
                              <b>{selected.fontSizePx.toFixed(1)} px</b>
                            </div>
                            <div className="kv">
                              <span>Line spacing</span>
                              <b>{selected.lineSpacingPx.toFixed(1)} px</b>
                            </div>
                            <div className="kv">
                              <span>Alignment</span>
                              <b>{selected.align}</b>
                            </div>
                            <div className="kv">
                              <span>Left indent</span>
                              <b>{selected.indentLeftPx.toFixed(0)} px</b>
                            </div>
                            <div className="kv">
                              <span>Space above</span>
                              <b>{selected.spaceBeforePx.toFixed(0)} px</b>
                            </div>
                            <div className="kv">
                              <span>Lines</span>
                              <b>{selected.lines.length}</b>
                            </div>

                            <div className="divider" />

                            <div>
                              <span style={{ fontSize: 11, fontWeight: 600, color: "var(--ink-secondary)", display: "block", marginBottom: 4 }}>
                                Text alignment
                              </span>
                              <div className="align-btn-group" role="group" aria-label="Text alignment">
                                {(["left", "center", "right", "justify"] as const).map((align) => (
                                  <button
                                    key={align}
                                    type="button"
                                    aria-pressed={selected.align === align}
                                    onClick={() => handleAlignChange(selected.id, align)}
                                    title={`Align ${align}`}
                                  >
                                    {align === "left" && (
                                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                                        <line x1="21" y1="6" x2="3" y2="6" /><line x1="15" y1="12" x2="3" y2="12" /><line x1="17" y1="18" x2="3" y2="18" />
                                      </svg>
                                    )}
                                    {align === "center" && (
                                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                                        <line x1="18" y1="6" x2="6" y2="6" /><line x1="21" y1="12" x2="3" y2="12" /><line x1="18" y1="18" x2="6" y2="18" />
                                      </svg>
                                    )}
                                    {align === "right" && (
                                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                                        <line x1="21" y1="6" x2="3" y2="6" /><line x1="21" y1="12" x2="9" y2="12" /><line x1="21" y1="18" x2="7" y2="18" />
                                      </svg>
                                    )}
                                    {align === "justify" && (
                                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                                        <line x1="21" y1="6" x2="3" y2="6" /><line x1="21" y1="12" x2="3" y2="12" /><line x1="21" y1="18" x2="3" y2="18" />
                                      </svg>
                                    )}
                                  </button>
                                ))}
                              </div>
                            </div>

                            <div className="divider" />

                            <label className="check">
                              <input
                                type="checkbox"
                                checked={Boolean(selected.bold)}
                                onChange={() => handleToggleBold(selected.id)}
                              />
                              <span>
                                Render in bold
                                <small>Headings and emphasis are preserved in DOCX.</small>
                              </span>
                            </label>

                            <button
                              type="button"
                              className="btn btn-sm btn-block"
                              style={{ marginTop: 10 }}
                              onClick={() => {
                                navigator.clipboard.writeText(selected.text);
                                push("info", "Paragraph text copied to clipboard.");
                              }}
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                              </svg>
                              Copy block text
                            </button>

                            <div className="divider" />
                            <div className="muted">{selected.text.length} characters</div>
                          </>
                        ) : (
                          <div className="muted">
                            Select a block on the page to inspect and adjust it.
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="panel">
                      <div className="panel-head">
                        <h2>Document setup</h2>
                      </div>
                      <div className="panel-body">
                        <div className="kv">
                          <span>Page</span>
                          <b>
                            {(layout.pageWidth / 1440).toFixed(1)} ×{" "}
                            {(layout.pageHeight / 1440).toFixed(1)} in
                          </b>
                        </div>
                        <div className="kv">
                          <span>Margins</span>
                          <b>
                            {(layout.marginTop / 1440).toFixed(2)} /{" "}
                            {(layout.marginRight / 1440).toFixed(2)} /{" "}
                            {(layout.marginBottom / 1440).toFixed(2)} /{" "}
                            {(layout.marginLeft / 1440).toFixed(2)} in
                          </b>
                        </div>
                        <div className="kv">
                          <span>Base font size</span>
                          <b>{layout.baseFontSizePt} pt</b>
                        </div>
                        <div className="kv">
                          <span>Columns</span>
                          <b>{layout.maxColumns}</b>
                        </div>
                        {layout.maxColumns > 1 ? (
                          <div className="pill-row" style={{ marginTop: 10 }}>
                            {layout.pages[0].columns.map((column, index) => (
                              <span className="pill" key={index}>
                                col {index + 1}: {Math.round(column.x1 - column.x0)} px
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="panel">
                  <div className="panel-head">
                    <h2>Recognised text</h2>
                    <span className="hint">in reading order</span>
                  </div>
                  <div className="panel-body">
                    {layout.pages.map((page) => (
                      <div key={page.index} style={{ marginBottom: 20 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                          <span className="badge">Page {page.index + 1}</span>
                          <span className="muted">{page.regions.length} regions</span>
                        </div>
                        {page.regions.map((region) => (
                          <div key={`${region.sliceIndex}-${region.columnIndex}`}>
                            {region.paragraphs.map((paragraph) => (
                              <p
                                key={paragraph.id}
                                style={{
                                  margin: "0 0 10px",
                                  paddingLeft: region.kind === "column" ? 16 : 0,
                                  borderLeft:
                                    region.kind === "column" ? "2px solid var(--accent-primary)" : undefined,
                                  whiteSpace: "pre-wrap",
                                }}
                              >
                                {paragraph.text}
                              </p>
                            ))}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      </main>

      <div className="mobile-bar">
        <button
          className="btn btn-primary btn-block"
          onClick={handleExport}
          disabled={!layout || exporting}
        >
          {exporting ? <span className="spinner" /> : null}
          {exporting ? "Building" : "Download DOCX"}
        </button>
      </div>

      <Toasts toasts={toasts} onDismiss={dismiss} />

      {dragging ? (
        <div className="drag-overlay">
          <div>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M12 16V4m0 0L7 9m5-5 5 5" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" strokeLinecap="round" />
            </svg>
            Drop the file to get started
          </div>
        </div>
      ) : null}
    </div>
  );
}
