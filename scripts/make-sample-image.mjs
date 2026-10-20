import { createCanvas } from "@napi-rs/canvas";
import fs from "node:fs";

// A4-ish page at 150 dpi with a two column layout.
const W = 1240;
const H = 1754;
const canvas = createCanvas(W, H);
const ctx = canvas.getContext("2d");
ctx.fillStyle = "#fff";
ctx.fillRect(0, 0, W, H);
ctx.fillStyle = "#000";

ctx.font = "bold 52px Georgia";
ctx.fillText("Quarterly Financial Report", 95, 145);

ctx.font = "30px Georgia";
[
  "The company reported strong growth across all",
  "regions this year. Revenue increased by twelve",
  "percent compared to the prior quarter.",
].forEach((text, index) => ctx.fillText(text, 95, 235 + index * 46));

ctx.font = "30px Georgia";
[
  "This is the left column of text that keeps",
  "going for a while with several lines of",
  "content that flows down the page.",
  "More paragraph text appears here below.",
].forEach((text, index) => ctx.fillText(text, 95, 450 + index * 46));

[
  "This is the right column, and it starts",
  "at a clearly different horizontal offset",
  "from the left column of the document.",
  "It contains its own independent content.",
].forEach((text, index) => ctx.fillText(text, 700, 450 + index * 46));

ctx.font = "30px Georgia";
ctx.fillText("A full width closing paragraph that spans", 95, 720);
ctx.fillText("across both columns of the page entirely.", 95, 766);

fs.mkdirSync("samples", { recursive: true });
fs.writeFileSync("samples/sample.png", canvas.toBuffer("image/png"));
console.log("wrote samples/sample.png", W, "x", H);
