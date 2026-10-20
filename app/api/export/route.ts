import { NextResponse } from "next/server";
import { buildDocx } from "@/lib/docx/build";
import { DEFAULT_EXPORT_OPTIONS, type DocumentLayout, type ExportOptions } from "@/lib/types";

export const runtime = "nodejs";

function parseOptions(raw: unknown): ExportOptions {
  const parsed = (raw ?? {}) as Partial<ExportOptions>;
  const columnModes = ["auto", "table", "native", "single"] as const;
  const pageSizes = ["auto", "a4", "letter", "legal"] as const;

  return {
    fontFamily:
      typeof parsed.fontFamily === "string" && parsed.fontFamily.trim()
        ? parsed.fontFamily.trim()
        : null,
    fontSizePt:
      typeof parsed.fontSizePt === "number" && parsed.fontSizePt >= 4 && parsed.fontSizePt <= 96
        ? parsed.fontSizePt
        : null,
    columnMode: columnModes.includes(parsed.columnMode as never)
      ? (parsed.columnMode as ExportOptions["columnMode"])
      : DEFAULT_EXPORT_OPTIONS.columnMode,
    pageSize: pageSizes.includes(parsed.pageSize as never)
      ? (parsed.pageSize as ExportOptions["pageSize"])
      : DEFAULT_EXPORT_OPTIONS.pageSize,
    preserveSpacing: parsed.preserveSpacing !== false,
    preserveBreaks: parsed.preserveBreaks !== false,
  };
}

export async function POST(request: Request) {
  let body: { layout?: DocumentLayout; options?: ExportOptions };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const layout = body.layout;
  if (!layout || !Array.isArray(layout.pages) || !layout.pages.length) {
    return NextResponse.json({ error: "No document layout was supplied." }, { status: 400 });
  }

  try {
    const options = parseOptions(body.options);
    const buffer = await buildDocx(layout, options);
    const name = (layout.pages[0]?.regions[0]?.paragraphs[0]?.text ?? "document")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .slice(0, 60)
      .replace(/\s+/g, "-")
      .toLowerCase();

    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${name || "document"}.docx"`,
        "Content-Length": String(buffer.length),
      },
    });
  } catch (error) {
    console.error("[export]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not build the document." },
      { status: 500 },
    );
  }
}
