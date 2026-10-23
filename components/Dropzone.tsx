"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type DropzoneProps = {
  file: File | null;
  onFile: (file: File | null) => void;
  disabled?: boolean;
};

export function Dropzone({ file, onFile, disabled }: DropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      const picked = files?.[0];
      if (picked) onFile(picked);
      if (inputRef.current) inputRef.current.value = "";
    },
    [onFile],
  );

  const handleRemove = useCallback(() => {
    onFile(null);
    if (inputRef.current) inputRef.current.value = "";
  }, [onFile]);

  // pasting a screenshot works on every modern browser
  useEffect(() => {
    if (disabled) return;
    const onPaste = (event: ClipboardEvent) => {
      const items = event.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          const blob = item.getAsFile();
          if (blob) {
            event.preventDefault();
            onFile(new File([blob], `pasted-${Date.now()}.png`, { type: blob.type }));
            return;
          }
        }
      }
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [disabled, onFile]);

  const isPdfFile = file?.name.toLowerCase().endsWith(".pdf") || file?.type === "application/pdf";

  return (
    <div className="dropzone-container">
      <div
        className={`dropzone${over ? " over" : ""}${file ? " has-file" : ""}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setOver(false);
          handleFiles(event.dataTransfer.files);
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            inputRef.current?.click();
          }
        }}
        aria-label="Upload a PDF or image"
      >
        <div className="dropzone-scanner-beam" />
        <div className="dropzone-icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M12 16V4m0 0L7 9m5-5 5 5" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" strokeLinecap="round" />
          </svg>
        </div>
        <strong>Drop a PDF or image here</strong>
        <span>
          or click to browse &middot; <kbd>Ctrl</kbd> + <kbd>V</kbd> to paste
        </span>
        <div className="format-tags">
          <span className="fmt-tag">PDF</span>
          <span className="fmt-tag">PNG</span>
          <span className="fmt-tag">JPG</span>
          <span className="fmt-tag">TIFF</span>
          <span className="fmt-tag">WEBP</span>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/*,application/pdf,.pdf,.png,.jpg,.jpeg,.webp,.tif,.tiff,.bmp,.gif"
          hidden
          disabled={disabled}
          onChange={(event) => handleFiles(event.target.files)}
        />
      </div>

      {file ? (
        <div className="file-chip">
          <div className={`file-type-badge ${isPdfFile ? "badge-pdf" : "badge-img"}`}>
            {isPdfFile ? "PDF" : "IMG"}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="name" title={file.name}>
              {file.name}
            </div>
            <div className="meta">
              <span>{file.size > 1024 * 1024 ? `${(file.size / (1024 * 1024)).toFixed(1)} MB` : `${(file.size / 1024).toFixed(0)} KB`}</span>
              <span className="bullet">&bull;</span>
              <span>Ready to process</span>
            </div>
          </div>
          <button className="btn btn-sm btn-ghost file-remove" onClick={handleRemove} disabled={disabled} title="Remove file">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
            Remove
          </button>
        </div>
      ) : null}
    </div>
  );
}
