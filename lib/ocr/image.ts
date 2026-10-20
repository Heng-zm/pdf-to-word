import sharp from "sharp";

export type PageImage = {
  width: number;
  height: number;
  /** greyscale, 8 bit per pixel */
  gray: Buffer;
  /** png buffer that is fed to the OCR engine */
  png: Buffer;
  /** 1 = ink, 0 = background */
  mask: Uint8Array;
};

export type Band = {
  y0: number;
  y1: number;
  x0: number;
  x1: number;
  /** per-pixel ink flags along x */
  ink: Uint8Array;
  /** total number of ink pixels */
  inkCount: number;
  /** columns this row contributes text to (empty = full width row) */
  columns: number[];
};

export type Gutter = { x0: number; x1: number };

export type Geometry = {
  width: number;
  height: number;
  bands: Band[];
  /** detected columns in page pixels */
  columns: { x0: number; x1: number }[];
  gutters: Gutter[];
  /** horizontal extent of the text block */
  contentLeft: number;
  contentRight: number;
  /** median height of a text row, in px */
  medianRowHeight: number;
};

/** Otsu threshold over a greyscale buffer. */
export function otsuThreshold(gray: Buffer): number {
  const hist = new Uint32Array(256);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
  const total = gray.length;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];

  let sumB = 0;
  let wB = 0;
  let best = -1;
  let threshold = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) {
      best = between;
      threshold = t;
    }
  }
  return threshold;
}

/**
 * Decode an uploaded file into a page image plus an ink mask.
 * `binarize` produces a hard black/white png which helps Tesseract on
 * low-contrast scans; otherwise the greyscale image is used as-is.
 */
export async function loadPageImage(
  buffer: Buffer,
  opts: { maxEdge: number; binarize: boolean },
): Promise<PageImage> {
  let pipeline = sharp(buffer, { failOn: "none" }).rotate(); // honour EXIF orientation
  const meta = await pipeline.metadata();

  const longest = Math.max(meta.width ?? 0, meta.height ?? 0);
  if (longest > opts.maxEdge) {
    pipeline = pipeline.resize({
      width: meta.width! >= meta.height! ? opts.maxEdge : undefined,
      height: meta.height! > meta.width! ? opts.maxEdge : undefined,
      fit: "inside",
      withoutEnlargement: true,
    });
  }

  const { data: gray, info } = await pipeline
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height } = info;
  const threshold = otsuThreshold(gray);
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < gray.length; i++) mask[i] = gray[i] < threshold ? 1 : 0;

  let png: Buffer;
  if (opts.binarize) {
    const binary = Buffer.alloc(width * height);
    for (let i = 0; i < mask.length; i++) binary[i] = mask[i] ? 0 : 255;
    png = await sharp(binary, { raw: { width, height, channels: 1 } }).png().toBuffer();
  } else {
    png = await sharp(gray, { raw: { width, height, channels: 1 } }).png().toBuffer();
  }

  return { width, height, gray, png, mask };
}

/** Estimate the skew angle (radians) of the text by maximising projection variance. */
export function estimateSkew(gray: Buffer, width: number, height: number): number {
  const threshold = otsuThreshold(gray);
  const ink = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return 0;
    return gray[y * width + x] < threshold ? 1 : 0;
  };

  const angles: number[] = [];
  for (let deg = -5; deg <= 5; deg += 0.5) angles.push((deg * Math.PI) / 180);
  let bestAngle = 0;
  let bestScore = -1;

  const step = Math.max(1, Math.round(height / 600));
  for (const angle of angles) {
    const tan = Math.tan(angle);
    const bins = new Float64Array(height * 2);
    let peak = 0;
    for (let y = 0; y < height; y += step) {
      for (let x = 0; x < width; x += step) {
        if (!ink(x, y)) continue;
        const yy = Math.round(y + x * tan);
        const idx = yy + height;
        if (idx >= 0 && idx < bins.length) {
          bins[idx] += 1;
          if (bins[idx] > peak) peak = bins[idx];
        }
      }
    }
    let score = 0;
    for (let i = 0; i < bins.length; i++) score += bins[i] * bins[i];
    if (score > bestScore) {
      bestScore = score;
      bestAngle = angle;
    }
  }
  return bestAngle;
}

/** Rotate a page so that its text lines are horizontal. */
export async function deskewPage(png: Buffer, angle: number): Promise<Buffer> {
  if (Math.abs(angle) < 0.002) return png;
  return sharp(png)
    .rotate(angle * (180 / Math.PI), { background: "#ffffff" })
    .png()
    .toBuffer();
}

/**
 * Split a horizontal ink profile into text lines.
 *
 * The obvious approach - a line ends where the ink stops - breaks down for
 * scripts whose combining marks reach into the neighbouring line. Khmer
 * subscripts hang below the baseline and the vowel signs above it, so two
 * lines are often vertically connected and end up as one huge block.
 *
 * Instead the profile is thresholded: rows that carry as much ink as a real
 * text row belong to a line, rows with only a few stray marks are the gap
 * between two lines. Otsu's method finds that threshold automatically.
 */
function otsuOnProfile(profile: number[]): number {
  let max = 0;
  for (const value of profile) if (value > max) max = value;
  if (max === 0) return 0;

  const histogram = new Uint32Array(max + 1);
  for (const value of profile) histogram[value]++;

  const total = profile.length;
  let sum = 0;
  for (let t = 0; t <= max; t++) sum += t * histogram[t];

  let sumBackground = 0;
  let weightBackground = 0;
  let best = -1;
  let threshold = 0;
  for (let t = 0; t <= max; t++) {
    weightBackground += histogram[t];
    if (!weightBackground) continue;
    const weightForeground = total - weightBackground;
    if (!weightForeground) break;
    sumBackground += t * histogram[t];
    const meanBackground = sumBackground / weightBackground;
    const meanForeground = (sum - sumBackground) / weightForeground;
    const between = weightBackground * weightForeground * (meanBackground - meanForeground) ** 2;
    if (between > best) {
      best = between;
      threshold = t;
    }
  }
  return threshold;
}

/** Debug helper: the ink profile of a page and the runs the analysis found. */
export function analyzeProfile(mask: Uint8Array, width: number, height: number) {
  const profile = new Int32Array(height);
  for (let y = 0; y < height; y++) {
    let count = 0;
    const offset = y * width;
    for (let x = 0; x < width; x++) count += mask[offset + x];
    profile[y] = count;
  }
  const threshold = otsuOnProfile(Array.from(profile));
  const runs: { start: number; end: number }[] = [];
  let start = -1;
  for (let y = 0; y <= height; y++) {
    const on = y < height && profile[y] > threshold;
    if (on) {
      if (start < 0) start = y;
    } else if (start >= 0) {
      runs.push({ start, end: y - 1 });
      start = -1;
    }
  }
  return { profile: Array.from(profile), threshold, runs };
}

function computeBands(mask: Uint8Array, width: number, height: number): Band[] {
  const profile = new Int32Array(height);
  for (let y = 0; y < height; y++) {
    let count = 0;
    const offset = y * width;
    for (let x = 0; x < width; x++) count += mask[offset + x];
    profile[y] = count;
  }

  const threshold = otsuOnProfile(Array.from(profile));

  // rows that carry a real text line
  const runs: { start: number; end: number }[] = [];
  let start = -1;
  for (let y = 0; y <= height; y++) {
    const on = y < height && profile[y] > threshold;
    if (on) {
      if (start < 0) start = y;
    } else if (start >= 0) {
      runs.push({ start, end: y - 1 });
      start = -1;
    }
  }
  if (!runs.length) return [];

  // A line whose ink profile dips below the threshold in the middle is cut
  // into pieces. Neighbouring pieces that together are still one line are
  // glued back together.
  const runHeights = runs.map((run) => run.end - run.start + 1).sort((a, b) => a - b);
  const medianRunHeight = runHeights[Math.floor(runHeights.length / 2)];
  const mergedRuns: { start: number; end: number }[] = [];
  for (const run of runs) {
    const last = mergedRuns[mergedRuns.length - 1];
    if (last) {
      const gap = run.start - last.end - 1;
      const combined = last.end - last.start + 1 + (run.end - run.start + 1);
      if (gap <= 1 && combined <= medianRunHeight * 1.4) {
        last.end = run.end;
        continue;
      }
    }
    mergedRuns.push({ ...run });
  }

  // The band covers the marks that hang below a line, but the ink of the
  // line itself is what the geometry is based on - including the sparse top
  // rows of the following line would make it look far too wide.
  //
  // The border between two bands sits in the middle of the gap between their
  // cores, so that every band holds the complete line.
  const bands: Band[] = [];
  for (let index = 0; index < mergedRuns.length; index++) {
    const run = mergedRuns[index];
    const previous = mergedRuns[index - 1];
    const next = mergedRuns[index + 1];

    const y0 = previous ? Math.floor((previous.end + run.start) / 2) + 1 : 0;
    const y1 = next ? Math.floor((run.end + next.start) / 2) - 1 : height - 1;
    if (y1 < y0) continue;

    const ink = new Uint8Array(width);
    let x0 = width;
    let x1 = -1;
    let inkCount = 0;
    for (let y = run.start; y <= run.end; y++) {
      const offset = y * width;
      for (let x = 0; x < width; x++) {
        if (mask[offset + x]) {
          ink[x] = 1;
          inkCount++;
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
        }
      }
    }
    if (inkCount < 6 || x1 < x0) continue;
    bands.push({ y0, y1, x0, x1, ink, inkCount, columns: [] });
  }
  return bands;
}

type RowGroup = {
  bands: Band[];
  /** horizontally disjoint blocks inside the row group */
  blocks: { x0: number; x1: number }[];
  /** whitespace corridors between those blocks */
  gaps: { x0: number; x1: number }[];
};

/** Contiguous runs of ink inside a band. */
function computeRuns(ink: Uint8Array): { x0: number; x1: number }[] {
  const runs: { x0: number; x1: number }[] = [];
  let start = -1;
  for (let x = 0; x < ink.length; x++) {
    if (ink[x]) {
      if (start < 0) start = x;
    } else if (start >= 0) {
      runs.push({ x0: start, x1: x - 1 });
      start = -1;
    }
  }
  if (start >= 0) runs.push({ x0: start, x1: ink.length - 1 });
  return runs;
}

/** Find the whitespace gap whose centre is closest to an ideal position. */
function findGapNear(
  bands: Band[],
  ideal: number,
  minGapWidth: number,
): Gutter | null {
  let best: Gutter | null = null;
  let bestDistance = Infinity;
  for (const band of bands) {
    const runs = computeRuns(band.ink);
    for (let i = 1; i < runs.length; i++) {
      const gap = { x0: runs[i - 1].x1 + 1, x1: runs[i].x0 - 1 };
      if (gap.x1 - gap.x0 + 1 < minGapWidth) continue;
      const distance = Math.abs((gap.x0 + gap.x1) / 2 - ideal);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = gap;
      }
    }
  }
  return best;
}

export type ColumnDetection = {
  columns: { x0: number; x1: number }[];
  gutters: Gutter[];
  /** vertical span of the column area */
  columnTop: number;
  columnBottom: number;
};

/**
 * Detect the column separator of a page.
 *
 * Every text row is cut into the runs of ink it contains, and the whitespace
 * between two runs becomes a candidate separator. Only gaps that are wide
 * enough to be a column gutter are considered - a word space is far too
 * narrow to separate two columns.
 *
 * A real separator shows up in the same place on many rows, so the votes per x
 * position reveal it. One-off gaps (a wide word space, a bullet, a short
 * heading next to a long one) only get a single vote and are ignored.
 */
export function detectColumns(bands: Band[], width: number, medianRowHeight: number): ColumnDetection {
  const empty: ColumnDetection = { columns: [], gutters: [], columnTop: 0, columnBottom: 0 };
  if (bands.length < 3) return empty;

  const contentLeft = Math.min(...bands.map((band) => band.x0));
  const contentRight = Math.max(...bands.map((band) => band.x1));

  const minGapWidth = Math.max(8, Math.round(medianRowHeight * 0.75));
  const votes = new Int32Array(width);
  const gaps: Gutter[] = [];

  for (const band of bands) {
    const runs = computeRuns(band.ink);
    for (let i = 1; i < runs.length; i++) {
      const gap = { x0: runs[i - 1].x1 + 1, x1: runs[i].x0 - 1 };
      if (gap.x1 - gap.x0 + 1 < minGapWidth) continue;
      gaps.push(gap);
      for (let x = gap.x0; x <= gap.x1; x++) votes[x]++;
    }
  }

  let maxVote = 0;
  for (let x = 0; x < width; x++) if (votes[x] > maxVote) maxVote = votes[x];
  if (maxVote < 2) return empty;

  // the longest run of positions that received the maximum number of votes
  let coreX0 = -1;
  let coreX1 = -1;
  let runStart = -1;
  for (let x = 0; x <= width; x++) {
    const isMax = x < width && votes[x] === maxVote;
    if (isMax) {
      if (runStart < 0) runStart = x;
    } else if (runStart >= 0) {
      if (coreX0 < 0 || x - runStart > coreX1 - coreX0) {
        coreX0 = runStart;
        coreX1 = x - 1;
      }
      runStart = -1;
    }
  }
  if (coreX0 < 0) return empty;

  // the separator is the whitespace that all the supporting rows agree on
  const supporting = gaps.filter((gap) => gap.x0 <= coreX1 && gap.x1 >= coreX0);
  let gutterX0 = coreX0;
  let gutterX1 = coreX1;
  if (supporting.length) {
    const intersectionX0 = Math.max(...supporting.map((gap) => gap.x0));
    const intersectionX1 = Math.min(...supporting.map((gap) => gap.x1));
    if (intersectionX1 >= intersectionX0) {
      gutterX0 = intersectionX0;
      gutterX1 = intersectionX1;
    }
  }

  const gutters: Gutter[] = [];
  const minGutterWidth = Math.max(6, Math.round(medianRowHeight * 0.6));
  const maxGutterWidth = Math.round((contentRight - contentLeft) * 0.4);

  if (
    gutterX1 - gutterX0 + 1 >= minGutterWidth &&
    gutterX1 - gutterX0 + 1 <= maxGutterWidth &&
    gutterX0 > contentLeft + medianRowHeight * 0.5 &&
    gutterX1 < contentRight - medianRowHeight * 0.5
  ) {
    gutters.push({ x0: gutterX0, x1: gutterX1 });
  }

  if (!gutters.length) return empty;

  const columns: { x0: number; x1: number }[] = [];
  let cursor = contentLeft;
  for (const gutter of gutters) {
    if (gutter.x0 <= cursor) continue;
    columns.push({ x0: cursor, x1: gutter.x0 - 1 });
    cursor = gutter.x1 + 1;
  }
  columns.push({ x0: cursor, x1: contentRight });
  if (columns.length < 2) return empty;

  // both columns have to carry a meaningful amount of text
  const totalInk = bands.reduce((sum, band) => sum + band.inkCount, 0);
  for (const column of columns) {
    const ink = bands
      .filter((band) => band.x1 >= column.x0 && band.x0 <= column.x1)
      .reduce((sum, band) => sum + band.inkCount, 0);
    if (ink < totalInk * 0.06) return empty;
  }

  const columnBands = bands.filter(
    (band) => !gutters.some((gutter) => band.x0 <= gutter.x1 && band.x1 >= gutter.x0),
  );
  const columnTop = columnBands.length ? Math.min(...columnBands.map((b) => b.y0)) : 0;
  const columnBottom = columnBands.length ? Math.max(...columnBands.map((b) => b.y1)) : 0;

  return { columns, gutters, columnTop, columnBottom };
}

/**
 * Analyse the page geometry: text rows, column gutters and the assignment of
 * every text row to a column (or to the full width).
 */
export function analyzeGeometry(
  mask: Uint8Array,
  width: number,
  height: number,
  forceColumns: number | null,
): Geometry {
  const bands = computeBands(mask, width, height);
  const heights = bands.map((b) => b.y1 - b.y0 + 1).sort((a, b) => a - b);
  const medianRowHeight = heights.length
    ? heights[Math.floor(heights.length / 2)]
    : Math.max(4, Math.round(height / 50));

  let columns: { x0: number; x1: number }[] = [];
  let gutters: Gutter[] = [];
  let columnTop = 0;
  let columnBottom = height;

  if (forceColumns && forceColumns > 1 && bands.length) {
    // the user told us how many columns there are, so the boundaries are
    // snapped to the whitespace closest to the ideal position
    const contentLeft = Math.min(...bands.map((b) => b.x0));
    const contentRight = Math.max(...bands.map((b) => b.x1));
    const total = contentRight - contentLeft;
    const minGapWidth = Math.max(6, Math.round(medianRowHeight * 0.6));

    const boundaries: number[] = [];
    for (let i = 1; i < forceColumns; i++) {
      const ideal = contentLeft + (total * i) / forceColumns;
      const gap = findGapNear(bands, ideal, minGapWidth);
      boundaries.push(gap ? (gap.x0 + gap.x1) / 2 : ideal);
    }

    let cursor = contentLeft;
    for (const boundary of boundaries) {
      const x0 = Math.round(cursor);
      const x1 = Math.round(boundary) - 1;
      if (x1 > x0) columns.push({ x0, x1 });
      cursor = Math.round(boundary) + 1;
    }
    columns.push({ x0: Math.round(cursor), x1: contentRight });
    gutters = columns.slice(0, -1).map((c, i) => ({ x0: c.x1 + 1, x1: columns[i + 1].x0 - 1 }));
  } else if (forceColumns !== 1) {
    const detection = detectColumns(bands, width, medianRowHeight);
    columns = detection.columns;
    gutters = detection.gutters;
    columnTop = detection.columnTop;
    columnBottom = detection.columnBottom;
  }

  // assign each row to the columns it contributes text to
  for (const band of bands) {
    band.columns = [];
    if (!columns.length) continue;

    // A row that carries ink inside a gutter runs across the separator (a
    // title or a paragraph that spans the whole page). A single pixel that
    // pokes into the corridor is just a slightly long line.
    let crosses = false;
    for (const gutter of gutters) {
      let inside = 0;
      for (let x = gutter.x0; x <= gutter.x1; x++) {
        if (x >= band.x0 && x <= band.x1 && band.ink[x]) inside++;
      }
      if (inside > (gutter.x1 - gutter.x0 + 1) * 0.35) {
        crosses = true;
        break;
      }
    }
    if (crosses) continue;

    for (let i = 0; i < columns.length; i++) {
      const col = columns[i];
      for (let x = col.x0; x <= col.x1; x++) {
        if (x >= band.x0 && x <= band.x1 && band.ink[x]) {
          band.columns.push(i);
          break;
        }
      }
    }
  }

  // Content that sits clearly above or below the column area is a header or
  // a footer and spans the whole page. The column area is where all columns
  // overlap, so a stray line does not widen it.
  if (columns.length >= 2) {
    const spans = columns.map((_, index) => {
      const list = bands.filter((band) => band.columns.includes(index));
      return {
        top: list.length ? Math.min(...list.map((band) => band.y0)) : Number.MAX_SAFE_INTEGER,
        bottom: list.length ? Math.max(...list.map((band) => band.y1)) : 0,
      };
    });
    const columnTop = Math.max(...spans.map((span) => span.top));
    const columnBottom = Math.min(...spans.map((span) => span.bottom));
    const gapTolerance = medianRowHeight * 2;

    for (const band of bands) {
      if (!band.columns.length) continue;
      if (band.y1 < columnTop - gapTolerance || band.y0 > columnBottom + gapTolerance) {
        band.columns = [];
      }
    }
  }

  const assignedBands = bands.filter((b) => b.columns.length);
  const contentLeft = assignedBands.length
    ? Math.min(...assignedBands.map((b) => b.x0))
    : bands.length
      ? Math.min(...bands.map((b) => b.x0))
      : 0;
  const contentRight = assignedBands.length
    ? Math.max(...assignedBands.map((b) => b.x1))
    : bands.length
      ? Math.max(...bands.map((b) => b.x1))
      : width;

  return { width, height, bands, columns, gutters, contentLeft, contentRight, medianRowHeight };
}

export type SliceCell = {
  columnIndex: number;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  bands: Band[];
};

export type Slice = {
  kind: "full" | "columns";
  y0: number;
  y1: number;
  x0: number;
  x1: number;
  bands: Band[];
  cells: SliceCell[];
};

/**
 * Cut the page into horizontal slices.
 *
 * A slice is either full width (title, spanning paragraph) or made up of one
 * or more columns. Slices are the unit that is later turned into Word
 * paragraphs or a borderless table that reproduces the column gutters.
 */
export function buildSlices(geometry: Geometry): Slice[] {
  const bands = [...geometry.bands].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  const slices: Slice[] = [];
  let current: Slice | null = null;

  for (const band of bands) {
    const kind: Slice["kind"] = band.columns.length ? "columns" : "full";
    if (!current || current.kind !== kind) {
      current = {
        kind,
        y0: band.y0,
        y1: band.y1,
        x0: band.x0,
        x1: band.x1,
        bands: [band],
        cells: [],
      };
      slices.push(current);
    } else {
      current.bands.push(band);
      current.y1 = Math.max(current.y1, band.y1);
      current.x0 = Math.min(current.x0, band.x0);
      current.x1 = Math.max(current.x1, band.x1);
    }
  }

  for (const slice of slices) {
    if (slice.kind !== "columns") continue;
    const grouped = new Map<number, Band[]>();
    for (const band of slice.bands) {
      for (const columnIndex of band.columns) {
        const list = grouped.get(columnIndex) ?? [];
        list.push(band);
        grouped.set(columnIndex, list);
      }
    }
    for (const [columnIndex, columnBands] of grouped) {
      const column = geometry.columns[columnIndex];
      slice.cells.push({
        columnIndex,
        x0: column?.x0 ?? Math.min(...columnBands.map((b) => b.x0)),
        x1: column?.x1 ?? Math.max(...columnBands.map((b) => b.x1)),
        y0: Math.min(...columnBands.map((b) => b.y0)),
        y1: Math.max(...columnBands.map((b) => b.y1)),
        bands: columnBands,
      });
    }
    slice.cells.sort((a, b) => a.columnIndex - b.columnIndex);
  }

  return slices;
}
