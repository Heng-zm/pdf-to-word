import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import fs from 'node:fs';

const doc = await PDFDocument.create();
const page = doc.addPage([595.28, 841.89]); // A4 in points
const font = await doc.embedFont(StandardFonts.Helvetica);
const bold = await doc.embedFont(StandardFonts.HelveticaBold);

const draw = (text, x, y, size = 10, isBold = false) => {
  page.drawText(text, { x, y, size, font: isBold ? bold : font, color: rgb(0.1, 0.1, 0.1) });
};

const LEFT = 45;
const RIGHT = 315;

draw('Product Requirements Document', LEFT, 760, 16, true);
draw('Version 2.1 - Confidential', LEFT, 742, 9);

draw('This document describes the functional requirements for the', LEFT, 710, 10);
draw('platform. It is intended for engineering, product and support.', LEFT, 696, 10);

draw('Overview', LEFT, 660, 11, true);
const left = [
  'The system ingests documents, extracts',
  'their text and reconstructs a faithful,',
  'editable representation of the original',
  'layout. Column structure, spacing and',
  'emphasis are preserved so that the result',
  'can be revised in Word. Each page is',
  'analysed independently before the final',
  'document is assembled.',
];
left.forEach((t, i) => draw(t, LEFT, 644 - i * 15, 10));

draw('Requirements', LEFT, 508, 11, true);
[
  'Images and PDFs are both accepted as',
  'input. The service renders PDF pages at',
  'a fixed resolution and runs the',
  'recognition engine over every region.',
].forEach((t, i) => draw(t, LEFT, 492 - i * 15, 10));

draw('Data Model', RIGHT, 660, 11, true);
const right = [
  'A page is described as a list of regions.',
  'A region is either full width or bound to',
  'a single column. Every region owns',
  'paragraphs, and every paragraph owns',
  'lines.',
  '',
  'The exporter walks the regions in reading',
  'order and emits Word paragraphs, grouped',
  'into a table so that the column gutter is',
  'reproduced exactly.',
];
right.forEach((t, i) => draw(t, RIGHT, 644 - i * 15, 10));

draw('Open Questions', RIGHT, 494, 11, true);
[
  'How should hyphenated words at a line',
  'break be handled? Should a detected',
  'heading force a page break?',
].forEach((t, i) => draw(t, RIGHT, 478 - i * 15, 10));

draw('End of document.', LEFT, 80, 10);

// ---------------------------------------------------------------- second page
const page2 = doc.addPage([595.28, 841.89]);
const draw2 = (text, x, y, size = 10, isBold = false) => {
  page2.drawText(text, { x, y, size, font: isBold ? bold : font, color: rgb(0.1, 0.1, 0.1) });
};

draw2('Appendix A - Glossary', LEFT, 780, 14, true);
draw2('A single column page keeps its own reading order.', LEFT, 752, 10);
draw2('Each paragraph is exported with the spacing that was measured', LEFT, 738, 10);
draw2('on the page, so the result can be edited without losing its shape.', LEFT, 724, 10);

draw2('Terms', LEFT, 690, 11, true);
const glossary = [
  ['Column', 'A vertical division of the text block that is read top to bottom.'],
  ['Gutter', 'The empty space between two columns.'],
  ['Region', 'A full width block or a block that belongs to one column.'],
  ['Slice', 'A horizontal band of the page that holds one or more regions.'],
  ['Baseline', 'The line a row of letters sits on.'],
  ['Twip', 'A twentieth of a point, the unit Word uses for measurements.'],
];
glossary.forEach(([term, description], index) => {
  draw2(term, LEFT, 668 - index * 16, 10, true);
  draw2(description, LEFT + 110, 668 - index * 16, 10);
});

const bytes = await doc.save();
fs.mkdirSync('samples', { recursive: true });
fs.writeFileSync('samples/sample.pdf', bytes);
console.log('wrote samples/sample.pdf', bytes.length, 'bytes');
