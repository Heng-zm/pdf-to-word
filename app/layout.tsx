import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ORC - image & PDF to editable DOCX",
  description:
    "Recognise text in images and PDFs and export it as an editable Word document that keeps the original columns, spacing and layout.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
