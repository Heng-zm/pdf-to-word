"use client";

import { useEffect, useRef } from "react";
import type { PageLayout, ParagraphLayout } from "@/lib/types";

type Props = {
  page: PageLayout;
  /** the width the page is rendered at, in pixels */
  width: number;
  showSource: boolean;
  showBoxes: boolean;
  fontFamily: string;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onEdit: (id: string, text: string) => void;
};

export function PageCanvas({
  page,
  width,
  showSource,
  showBoxes,
  fontFamily,
  selectedId,
  onSelect,
  onEdit,
}: Props) {
  const scale = width / page.widthPx;
  const height = Math.round(page.heightPx * scale);

  return (
    <div
      className={`canvas-wrap${showSource ? " show-source" : ""}`}
      style={{ width, height }}
      onMouseDown={() => onSelect(null)}
    >
      {page.image ? <img className="source" src={page.image} alt="" /> : null}

      <div className="overlay">
        {showBoxes
          ? page.regions.map((region, index) => (
              <div
                key={`${region.sliceIndex}-${region.columnIndex}-${index}`}
                className={`region-box ${region.kind}`}
                style={{
                  left: region.bbox.x0 * scale,
                  top: region.bbox.y0 * scale,
                  width: (region.bbox.x1 - region.bbox.x0) * scale,
                  height: (region.bbox.y1 - region.bbox.y0) * scale,
                }}
              />
            ))
          : null}

        <div className="text-layer">
          {page.regions.flatMap((region) =>
            region.paragraphs.map((paragraph) => (
              <EditableParagraph
                key={paragraph.id}
                paragraph={paragraph}
                scale={scale}
                fontFamily={fontFamily}
                regionWidth={(region.bbox.x1 - region.bbox.x0) * scale}
                selected={selectedId === paragraph.id}
                onSelect={onSelect}
                onEdit={onEdit}
              />
            )),
          )}
        </div>
      </div>
    </div>
  );
}

type EditableProps = {
  paragraph: ParagraphLayout;
  scale: number;
  fontFamily: string;
  regionWidth: number;
  selected: boolean;
  onSelect: (id: string) => void;
  onEdit: (id: string, text: string) => void;
};

function EditableParagraph({
  paragraph,
  scale,
  fontFamily,
  regionWidth,
  selected,
  onSelect,
  onEdit,
}: EditableProps) {
  const ref = useRef<HTMLDivElement>(null);
  const text = displayText(paragraph);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (node.innerText.replace(/\r/g, "") !== text) node.innerText = text;
  }, [text]);

  const width = Math.max(40, regionWidth - paragraph.indentLeftPx * scale);

  return (
    <div
      ref={ref}
      className={`para ${paragraph.align}${selected ? " selected" : ""}`}
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      onMouseDown={(event) => {
        event.stopPropagation();
        onSelect(paragraph.id);
      }}
      onBlur={(event) => {
        const value = event.currentTarget.innerText.replace(/\r/g, "").replace(/\n$/, "");
        if (value !== paragraph.text) onEdit(paragraph.id, value);
      }}
      style={{
        left: paragraph.bbox.x0 * scale,
        top: paragraph.bbox.y0 * scale,
        width,
        fontFamily,
        fontSize: paragraph.fontSizePx * scale,
        lineHeight: `${paragraph.lineSpacingPx * scale}px`,
        textAlign: paragraph.align === "justify" ? "justify" : paragraph.align,
        fontWeight: paragraph.bold ? 650 : 400,
      }}
    />
  );
}

function displayText(paragraph: ParagraphLayout): string {
  if (paragraph.text !== paragraph.originalText) return paragraph.text;
  return paragraph.lines.map((line) => line.text).join("\n");
}
