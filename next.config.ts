import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // these packages ship native binaries or worker threads and must not be bundled
  serverExternalPackages: [
    "tesseract.js",
    "tesseract.js-core",
    "sharp",
    "@napi-rs/canvas",
    "pdfjs-dist",
  ],
  outputFileTracingIncludes: {
    "/**": [
      "./node_modules/**/*.wasm",
      "./node_modules/**/*.proto",
      "./node_modules/tesseract.js/**/*",
      "./node_modules/tesseract.js-core/**/*",
      "./*.traineddata",
      "./*.traineddata.gz",
      "./tessdata/**/*",
    ],
    "/api/**/*": [
      "./node_modules/**/*.wasm",
      "./node_modules/**/*.proto",
      "./node_modules/tesseract.js/**/*",
      "./node_modules/tesseract.js-core/**/*",
      "./*.traineddata",
      "./*.traineddata.gz",
      "./tessdata/**/*",
    ],
  },
};

export default nextConfig;
