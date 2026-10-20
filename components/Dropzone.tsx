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
    },
    [onFile],
  );

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

  return (
    <div>
      <div
        className={`dropzone${over ? " over" : ""}`}
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
        <div className="dropzone-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M12 16V4m0 0L7 9m5-5 5 5" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" strokeLinecap="round" />
          </svg>
        </div>
        <strong>Drop a PDF or image here</strong>
        <span>
          or click to browse &middot; <kbd>Ctrl</kbd> + <kbd>V</kbd> to paste
        </span>
        <input
          ref={inputRef}
          type="file"
          accept="image/*,application/pdf,.pdf,.png,.jpg,.jpeg,.webp,.tif,.tiff"
          hidden
          disabled={disabled}
          onChange={(event) => handleFiles(event.target.files)}
        />
      </div>

      {file ? (
        <div className="file-chip">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
            <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" strokeLinejoin="round" />
            <path d="M14 3v5h5" strokeLinejoin="round" />
          </svg>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="name" title={file.name}>
              {file.name}
            </div>
            <div className="meta">{(file.size / 1024).toFixed(0)} KB</div>
          </div>
          <button className="btn btn-sm" onClick={() => onFile(null)} disabled={disabled}>
            Remove
          </button>
        </div>
      ) : null}
    </div>
  );
}
