import { NextResponse } from "next/server";
import { renderPdf, isPdf, isImage, toPreviewDataUrl } from "@/lib/ocr/pdf";
import { ocrPage, buildDocumentLayout } from "@/lib/ocr/recognize";
import { DEFAULT_OCR_OPTIONS, type OcrOptions, type OcrProgress } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_UPLOAD = 40 * 1024 * 1024;

function parseOptions(raw: string | null): OcrOptions {
  if (!raw) return { ...DEFAULT_OCR_OPTIONS };
  try {
    const parsed = JSON.parse(raw) as Partial<OcrOptions>;
    return {
      langs: typeof parsed.langs === "string" ? parsed.langs : DEFAULT_OCR_OPTIONS.langs,
      pdfScale: clampNumber(parsed.pdfScale, 1, 4, DEFAULT_OCR_OPTIONS.pdfScale),
      maxImageEdge: clampNumber(parsed.maxImageEdge, 800, 5000, DEFAULT_OCR_OPTIONS.maxImageEdge),
      deskew: Boolean(parsed.deskew),
      binarize: Boolean(parsed.binarize),
      forceColumns:
        typeof parsed.forceColumns === "number" && parsed.forceColumns >= 1 && parsed.forceColumns <= 6
          ? Math.round(parsed.forceColumns)
          : null,
    };
  } catch {
    return { ...DEFAULT_OCR_OPTIONS };
  }
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || Number.isNaN(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

export async function POST(request: Request) {
  const encoder = new TextEncoder();

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid upload." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD) {
    return NextResponse.json({ error: "The file is too large (max 40 MB)." }, { status: 413 });
  }

  const options = parseOptions(form.get("options") as string | null);

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;

      const send = (event: OcrProgress) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          closed = true;
        }
      };
      const close = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      try {
        const buffer = Buffer.from(await file.arrayBuffer());
        const isPdfFile = isPdf(buffer);

        if (!isPdfFile && !isImage(buffer)) {
          send({ type: "error", message: "Unsupported file type. Upload a PDF or an image." });
          return;
        }

        send({ type: "status", stage: "render", message: "Reading the document" });

        const rendered = isPdfFile
          ? await renderPdf(buffer, { scale: options.pdfScale, maxEdge: options.maxImageEdge })
          : [{ png: buffer, width: 0, height: 0 }];

        const pages = [];
        for (let index = 0; index < rendered.length; index++) {
          send({
            type: "page",
            page: index + 1,
            pages: rendered.length,
            stage: "recognise",
          });

          const preview = await toPreviewDataUrl(rendered[index].png, 900);
          const { page } = await ocrPage({ png: rendered[index].png, preview }, index, options);
          pages.push(page);
        }

        const layout = buildDocumentLayout(pages, options.langs, "auto");
        send({ type: "result", layout });
      } catch (error) {
        console.error("[ocr]", error);
        send({
          type: "error",
          message: error instanceof Error ? error.message : "Recognition failed.",
        });
      } finally {
        close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
