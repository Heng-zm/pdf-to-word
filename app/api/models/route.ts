import { NextResponse } from "next/server";
import { existsSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getAvailableModels, getCacheDir, invalidateWorker } from "@/lib/ocr/engine";

export const runtime = "nodejs";

const MAX_MODEL_SIZE = 120 * 1024 * 1024; // 120 MB max for best-int models

function sanitizeModelFilename(filename: string): string | null {
  const base = path.basename(filename).trim();
  if (!base.endsWith(".traineddata") && !base.endsWith(".traineddata.gz")) {
    return null;
  }
  // Allow alphanumeric, underscores, hyphens before .traineddata(.gz)
  if (!/^[a-zA-Z0-9_\-.]+\.traineddata(\.gz)?$/i.test(base)) {
    return null;
  }
  return base;
}

export async function GET() {
  try {
    const models = getAvailableModels();
    return NextResponse.json({ models });
  } catch (error) {
    console.error("[api/models GET]", error);
    return NextResponse.json({ error: "Failed to list models" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No model file provided" }, { status: 400 });
    }

    if (file.size > MAX_MODEL_SIZE) {
      return NextResponse.json(
        { error: `Model file is too large (max ${MAX_MODEL_SIZE / (1024 * 1024)} MB)` },
        { status: 413 }
      );
    }

    const sanitized = sanitizeModelFilename(file.name);
    if (!sanitized) {
      return NextResponse.json(
        { error: "Invalid model file. Must be a .traineddata or .traineddata.gz file." },
        { status: 400 }
      );
    }

    const cacheDir = getCacheDir();
    const targetPath = path.join(/*turbopackIgnore: true*/ cacheDir, sanitized);
    const buffer = Buffer.from(await file.arrayBuffer());

    writeFileSync(targetPath, buffer);
    await invalidateWorker();

    const name = sanitized.replace(/\.traineddata(\.gz)?$/i, "").toLowerCase();

    return NextResponse.json({
      success: true,
      model: {
        name,
        label: `${name} (Custom)`,
        sizeBytes: buffer.length,
        isCustom: true,
        filename: sanitized,
      },
    });
  } catch (error) {
    console.error("[api/models POST]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to upload model" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    let filename: string | null = null;
    const url = new URL(request.url);
    filename = url.searchParams.get("filename");

    if (!filename) {
      try {
        const body = await request.json();
        filename = body.filename ?? null;
      } catch {
        // body might be empty
      }
    }

    if (!filename) {
      return NextResponse.json({ error: "Filename parameter is required" }, { status: 400 });
    }

    const sanitized = sanitizeModelFilename(filename);
    if (!sanitized) {
      return NextResponse.json({ error: "Invalid filename" }, { status: 400 });
    }

    const cacheDir = getCacheDir();
    const targetPath = path.join(/*turbopackIgnore: true*/ cacheDir, sanitized);

    if (!existsSync(/*turbopackIgnore: true*/ targetPath)) {
      return NextResponse.json({ error: "Custom model file not found in cache" }, { status: 404 });
    }

    unlinkSync(targetPath);
    await invalidateWorker();

    return NextResponse.json({ success: true, removed: sanitized });
  } catch (error) {
    console.error("[api/models DELETE]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to remove model" },
      { status: 500 }
    );
  }
}
