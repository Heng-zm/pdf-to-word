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
};

export default nextConfig;
