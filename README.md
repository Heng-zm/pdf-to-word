# ORC — image & PDF to an editable Word document

Upload a scan or a PDF and get back a real `.docx` that you can edit in Word,
with the **columns, column gaps, line spacing, indents and alignment of the
original preserved**.

The recognised text is never an image. Every block is a normal Word
paragraph, so the result is fully editable, searchable and reflowable.

---

## How it works

```
 image / PDF
     │
     ├─ render      PDF pages are rasterised with pdf.js (pdfjs-dist)
     │
     ├─ analyse     ink mask, text rows, column gutters, page geometry
     │
     ├─ recognise   Tesseract runs on every detected region separately
     │
     ├─ structure   lines → paragraphs → regions (full width or column)
     │
     └─ export      paragraphs + a borderless table → .docx (docx)
```

### Column detection

The hard part of turning a scan into an editable document is telling columns
apart from ordinary text. Tesseract's own layout analysis merges two columns
into one line of garbled text, so this app does its own analysis first:

1. The page is binarised and cut into **text rows**.
2. Every row is cut into the **runs of ink** it contains. The whitespace
   between two runs is a candidate separator; only gaps wider than a line of
   text qualify, so word spaces are ignored.
3. Candidates are **voted on** per x position. A real column gutter appears in
   the same place on many rows, while one-off gaps (a bullet, a short heading
   next to a long one) only get a single vote.
4. The winning corridor is **tightened** to the whitespace that every
   supporting row agrees on, which is exactly the gap between the rightmost
   ink of the left column and the leftmost ink of the right column.
5. Rows that carry ink *inside* the gutter run across the columns and are
   treated as full-width elements (titles, spanning paragraphs). Rows above or
   below the column area become headers and footers.

### Regions

Each page becomes a list of horizontal **slices**. A slice is either full
width or made up of one or more columns. The slices are exported as:

* full-width slices → ordinary paragraphs,
* column slices → a borderless table whose cell widths and cell margins
  reproduce the measured column gutter exactly.

## The interface

```
┌────────────────────────────────────────────────────────────┐
│  ORC                                    2 pages  281 words  │
├──────────────┬─────────────────────────────────────────────┤
│  Document    │  Layout │ Text      − 100% +      20 paras │
│  ┌────────┐  │  ┌───────────────────────────────────────┐  │
│  │ drop   │  │  │  Page 1   1191×1684   2 columns      │  │
│  │ zone   │  │  │  ┌─────────────────────────────────┐  │  │
│  └────────┘  │  │  │  recognised text, positioned   │  │  │
│              │  │  │  exactly like the source page  │  │  │
│  Options     │  │  └─────────────────────────────────┘  │  │
│  ┌────────┐  │  └───────────────────────────────────────┘  │
│  │ source │  │                          ┌──────────────┐  │
│  │ output │  │                          │ Selected     │  │
│  └────────┘  │                          │ block        │  │
└──────────────┴──────────────────────────┴──────────────┴──┘
```

* **Drop a file anywhere** on the page, or press <kbd>Ctrl</kbd>+<kbd>V</kbd>
  to paste a screenshot straight from the clipboard.
* <kbd>Ctrl</kbd>+<kbd>Enter</kbd> starts the recognition.
* The preview shows the recognised text **on top of the original page**, at
  the position and size it was measured at. Click any block to correct it.
* The **Layout / Text** switch flips between the page view and a plain
  reading-order list of the recognised paragraphs.
* The zoom control goes from 50 % to 200 %; the page scrolls sideways when
  it is enlarged.
* The **Selected block** panel shows the measured size, line spacing,
  alignment and indent of the block you clicked, and can set it in bold.
* The layout is responsive: on a phone the options collapse into a drawer,
  the page fills the width and the export button moves to a bar at the
  bottom of the screen.

## Getting started

```bash
npm install
npm run dev          # http://localhost:3000
```

Open the app, drop in `samples/sample.pdf` or `samples/sample.png`, press
**Recognise text**, correct anything in the preview and press **Download
DOCX**.

`samples/sample-khmer.png` is a two column Khmer document if you want to try
the Khmer model (choose **Khmer** as the language).

### Offline language data

Tesseract downloads the language data on demand. To work without an internet
connection, fetch it up front:

```bash
npm run tessdata              # english
npm run tessdata -- khm deu   # khmer and german
```

The files are stored in `./tessdata` and are picked up automatically.

## Options

| Option | What it does |
| --- | --- |
| **Recognition language** | Language data for the OCR engine. |
| **PDF resolution** | 108–288 dpi. Higher is better for small print, slower. |
| **Columns** | Auto-detect, or force 1–4 columns. |
| **Binarise** | Hard black/white before recognition. Helps with faint or unevenly lit scans. |
| **Straighten the page** | Corrects a slight rotation of a photo. |
| **Typeface** | Font used in the exported document. Defaults to one that can render the chosen script. |
| **Base font size** | Overrides the detected body size; everything else scales with it. |
| **Page size** | Match the source, or force A4 / Letter / Legal. |
| **Column handling** | See below. |
| **Keep measured spacing** | Use the measured line height and paragraph gaps. |
| **Keep the original line breaks** | Otherwise the text reflows naturally. |

### Languages and scripts

The language list covers the scripts that need special handling as well as
the common Latin ones. Choosing a language also chooses a **typeface that can
actually render it** – Calibri and Arial contain no Khmer, Thai, CJK or
Arabic glyphs, so an exported document would show empty boxes.

| Language | Script | Default typeface |
| --- | --- | --- |
| English, German, French, … | Latin | Calibri |
| Khmer | Khmer | Khmer OS Battambang |
| Burmese | Myanmar | Myanmar Sans Pro |
| Thai | Thai | Leelawadee UI |
| Lao | Lao | DokChampa |
| Arabic | Arabic | Arial |
| Hindi | Devanagari | Nirmala UI |
| Chinese (simplified / traditional) | Han | Microsoft YaHei / JhengHei |
| Japanese | Japanese | Yu Gothic |
| Korean | Hangul | Malgun Gothic |

Two things differ for these scripts and are handled automatically:

* **Line detection.** Khmer subscripts hang far below the baseline and the
  vowel signs sit high above it, so two lines are often vertically connected.
  The text lines are therefore found by thresholding the horizontal ink
  profile instead of looking for empty rows.
* **Font size.** How far the tallest glyph reaches above the baseline
  depends on the script – a Khmer vowel sign can sit a full em high. The
  measurement is divided by a per-script ratio, so a 30 px body text is
  exported as 30 pt and not as 45 pt.


### Column handling modes

| Mode | Result |
| --- | --- |
| **Fixed table** *(default for multi-column pages)* | The column gutter is reproduced exactly, and each column keeps its own length. Fully editable. |
| **Word columns** | Real Word columns (`w:cols`). The text reflows and balances like a magazine layout. |
| **Single column** | Everything is flattened into one continuous flow. |

## Project layout

```
app/
  api/ocr/route.ts        upload → NDJSON progress stream → layout model
  api/export/route.ts     layout model → .docx
  error.tsx               friendly recovery when something goes wrong
  page.tsx                the workspace
components/
  Dropzone.tsx            file input, drag & drop and paste
  OptionsPanel.tsx        source and output settings
  PageCanvas.tsx          editable, position-accurate preview
  Toasts.tsx              transient notifications
lib/
  types.ts                the layout model shared by all three stages
  hooks.ts                media query, element width, hotkeys
  ocr/
    image.ts              binarising, text rows, column detection
    pdf.ts                PDF rasterising with pdf.js
    engine.ts             the shared Tesseract worker
    recognize.ts          page → regions → paragraphs
  layout/paragraphs.ts    lines → paragraphs, alignment, indents, spacing
  docx/build.ts           layout model → Word document
```
The **layout model** in `lib/types.ts` is the contract between the three
stages: the recogniser produces it, the browser edits it, the exporter turns
it into a document. Everything is measured in *page pixels*; the exporter
converts to twips so the spacing survives the trip into Word.

## Notes and limits

* Recognition quality depends on the scan. 150–200 dpi of clean, upright
  text gives the best results.
* Bold and italic cannot be recovered from a flat image. Headings can be
  marked bold by hand in the inspector.
* Rotated text is straightened automatically when **Straighten the page** is
  enabled; otherwise it is recognised as-is.
* Tables and figures in the source are not reproduced. A table keeps its two
  columns, but the text is read column by column - all left cells first, then
  all right cells - rather than row by row.
* Column detection needs at least a couple of text rows per column. A page
  with a single line in each column is better handled with the **Columns**
  override.

## Scripts

```bash
npm run dev          # start the development server
npm run build        # production build
npm run start        # run the production build
npm run typecheck    # tsc --noEmit
npm run tessdata     # pre-download the language data

node scripts/verify.mjs                  # end to end check against a running server
node scripts/test-ui.mjs                 # drives the interface in headless Chrome
node scripts/inspect-ui.mjs <url> <w> <h>  # find horizontal overflow
node scripts/shot-flow.mjs <url> <w> <h>  # screenshot the working view
node scripts/make-sample-pdf.mjs         # regenerate samples/sample.pdf
node scripts/make-sample-image.mjs       # regenerate samples/sample.png
node scripts/make-sample-khmer.mjs       # regenerate samples/sample-khmer.png
node scripts/debug-geometry.mjs <file>   # show the detected rows and columns
node scripts/debug-fontsize.mjs <file>   # show the measured font sizes
node scripts/debug-paragraphs.mjs <file> # show the paragraph structure
```
#   p d f - t o - w o r d  
 