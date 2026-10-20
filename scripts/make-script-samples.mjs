import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import fs from "node:fs";

/**
 * Reference pages for the script detector, one file per script.
 * The text is real prose in each language so the recognition behaves the way
 * it would on a real document.
 */
const SAMPLES = [
  {
    file: "sample-thai.png",
    font: "C:/Windows/Fonts/LEELAWAD.TTF",
    size: 30,
    lines: [
      "รายงานภาวะการเงินประจำไตรมาสแสดงให้เห็นถึง",
      "การเติบโตของรายได้และการลดลงของต้นทุน",
      "ในหลายภูมิภาคของประเทศ บริษัทยังคง",
      "ดำเนินกลยุทธ์เพื่อเพิ่มประสิทธิภาพในการ",
      "ทำงานและลดต้นทุนการผลิตให้ต่ำลง",
    ],
  },
  {
    file: "sample-burmese.png",
    font: "C:/Windows/Fonts/MyanmarSansPro.ttf",
    size: 30,
    lines: [
      "လောက်မှန်းချိုင်းစာရင်းတင်အတွင်း တင်မှု",
      "ပိုမိုကျွန်းပါသည် သို့မဟုတ် ကုန်သည်",
      "မြန်မာနိုင်ငံ့ နှင့် ကျော်လိုက်ချင်း",
      "လည်း ကောင်းရှိပါသည် ဖြစ်ပါသည်",
    ],
  },
  {
    file: "sample-arabic.png",
    font: "C:/Windows/Fonts/arial.ttf",
    size: 30,
    lines: [
      "يشير التقرير المالي إلى النمو القوي في",
      "الإيرادات خلال الربع الأخير من العام",
      "مع انخفاض طفيف في تكاليف التشغيل",
      "في جميع مناطق العمل الرئيسية",
    ],
  },
  {
    file: "sample-devanagari.png",
    font: "C:/Windows/Fonts/NirmalaB.ttf",
    size: 30,
    lines: [
      "वित्तीय रिपोर्ट से पता चलता है कि कंपनी",
      "ने इस तिमाही में मजबूत वृद्धि दर्ज की",
      "और परिचालन लागत में हल्की गिरावट आई",
    ],
  },
];

const W = 1240;
const H = 900;

for (const sample of SAMPLES) {
  if (!fs.existsSync(sample.font)) {
    console.log(`skip ${sample.file} (${sample.font} missing)`);
    continue;
  }
  GlobalFonts.registerFromPath(sample.font, "sample");
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#000";
  ctx.font = `${sample.size}px sample`;
  sample.lines.forEach((line, index) => ctx.fillText(line, 90, 150 + index * 55));
  fs.mkdirSync("samples", { recursive: true });
  fs.writeFileSync(`samples/${sample.file}`, canvas.toBuffer("image/png"));
  console.log(`wrote samples/${sample.file}`);
}
