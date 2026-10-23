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
    "/api/**/*": ["./*.traineddata", "./*.traineddata.gz", "./tessdata/**/*"],
  },
};

export default nextConfig;
