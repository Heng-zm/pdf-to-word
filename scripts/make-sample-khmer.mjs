import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import fs from "node:fs";

GlobalFonts.registerFromPath("C:/Windows/Fonts/KhmerOSBattambang-Regular.ttf", "KhmerBattambang");
GlobalFonts.registerFromPath("C:/Windows/Fonts/KhmerOSBattambang-Bold.ttf", "KhmerBattambangBold");

const W = 1240;
const H = 1754;
const canvas = createCanvas(W, H);
const ctx = canvas.getContext("2d");
ctx.fillStyle = "#fff";
ctx.fillRect(0, 0, W, H);
ctx.fillStyle = "#000";

const BODY = "30px KhmerBattambang";
const BOLD = "bold 32px KhmerBattambangBold";
const TITLE = "bold 52px KhmerBattambangBold";
const LEFT_X = 95;
const RIGHT_X = 700;
const LEFT_WIDTH = 530;
const RIGHT_WIDTH = 530;

// Khmer is written without spaces between the words, so the lines are wrapped
// by measuring the rendered width.
function wrap(text, maxWidth, font) {
  ctx.font = font;
  const lines = [];
  let current = "";
  for (const character of text) {
    const candidate = current + character;
    if (ctx.measureText(candidate).width > maxWidth && current) {
      lines.push(current);
      current = character;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

const heading = wrap("របាយការណ៍ទូទៅ", 900, TITLE);
const intro = wrap(
  "សេវាកម្មវិធីបង្កើតតាមការវាស់វុទ្ធនៅតំបន់ការងារទូទៅ និងស្គាល់ឥឡូវវាអាចកែសម្រួលនៅក្នុងកម្មវិធីការងារ ដោយរក្សាទម្រង់ជាក់នៃការបែងចែកជួរឈរ និងចន្លោះរវាងការសរសេរ។",
  900,
  BODY,
);
const leftHead = wrap("វិធីសម្រាប់ចំណាំងនេះ", LEFT_WIDTH, BOLD);
const left = wrap(
  "កម្មវិធីវាស់វុទ្ធនិម្មិតធ្វើការវាស់ជួរឈរទាំងអស់ដោយប្រើរបៀបបំពោះមើលការចែកចាន់នៅក្នុងរូបភាពទាំងអស់ ហើយក្នុងជួរឈរខាងឆ្វេងអក្សរចំពោះជាច្រើន ដោយរក្សាព្រះចិត្តបាត្រដូចដែលបានវាស់ទុកហើយ ដូច្នេះការកែសម្រួលឯកសារនៅក្នុងកម្មវិធីការងារតែមួយត្រូវបានបញ្ជាក់ដោយស្នើសម្រាប់អ្នកប្រើប្រូត។",
  LEFT_WIDTH,
  BODY,
);
const rightHead = wrap("ទិន្នន័យទិន្នន័យ", RIGHT_WIDTH, BOLD);
const right = wrap(
  "គ្រប់ទំព័រត្រូវបានកំណត់ជាក់ស្តីពេញ ដូច្នេះអ្នកអាចកែសម្រួលអត្ថបទបានដោយសេរីនៅក្នុងកម្មវិធីការងារ ហើយបន្ទាប់មកទៀតបានប្រគល់ជូនជាឯកសារ។",
  RIGHT_WIDTH,
  BODY,
);
const subHead = wrap("សេចក្តីសំណួរ", RIGHT_WIDTH, BOLD);
const sub = wrap(
  "តើត្រូវធ្វើដូចម្តេចប្រសិនបើពាក្យមួយត្រូវបានបែងចែកនៅចុងជើងនៃបន្ទាត់ តើត្រូវបង្ខំកិច្ចបង្ហាញទៅពីទំព័រថ្មីនៅក្នុងការចំណាំងនោះទេ",
  RIGHT_WIDTH,
  BODY,
);
const closing = wrap(
  "ក្រុមការងារស្មានធិបធយោបាយជាសសរសេរ ហើយបានបញ្ជាក់ថាចំណាំងនេះត្រូវបានបំលែងទៅជាឯកសារដែលអាចកែសម្រួលបាន។",
  900,
  BODY,
);

ctx.font = TITLE;
heading.forEach((text, index) => ctx.fillText(text, LEFT_X, 145 + index * 60));

ctx.font = BODY;
intro.forEach((text, index) => ctx.fillText(text, LEFT_X, 235 + index * 46));

ctx.font = BOLD;
leftHead.forEach((text, index) => ctx.fillText(text, LEFT_X, 450 + index * 46));
ctx.font = BODY;
left.forEach((text, index) => ctx.fillText(text, LEFT_X, 505 + index * 46));

ctx.font = BOLD;
rightHead.forEach((text, index) => ctx.fillText(text, RIGHT_X, 450 + index * 46));
ctx.font = BODY;
let rightY = 505;
right.forEach((text) => {
  ctx.fillText(text, RIGHT_X, rightY);
  rightY += 46;
});
ctx.font = BOLD;
subHead.forEach((text) => {
  ctx.fillText(text, RIGHT_X, rightY);
  rightY += 46;
});
ctx.font = BODY;
sub.forEach((text) => {
  ctx.fillText(text, RIGHT_X, rightY);
  rightY += 46;
});

ctx.font = BODY;
closing.forEach((text, index) => ctx.fillText(text, LEFT_X, 980 + index * 46));

fs.mkdirSync("samples", { recursive: true });
fs.writeFileSync("samples/sample-khmer.png", canvas.toBuffer("image/png"));
console.log("wrote samples/sample-khmer.png", W, "x", H);
