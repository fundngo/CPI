// Render a PDF (as base64) to one PNG per page, returning each page as base64.
// Uses pdfjs-dist + @napi-rs/canvas so there are no system dependencies on Railway.
// Works on PDFs with encoded/CID fonts (e.g. Funding Suite mortgage reports)
// because we render visually and let the vision model read the images.

import { createCanvas } from "@napi-rs/canvas";
// pdfjs-dist v5 ships an ESM entry; we use the legacy build for stable Node API.
// @ts-ignore - pdfjs has no types for the legacy path
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

// Disable the worker (we're running server-side, no need for worker threads)
// @ts-ignore
if (pdfjsLib.GlobalWorkerOptions) {
  // @ts-ignore
  pdfjsLib.GlobalWorkerOptions.workerSrc = false;
}

export type PdfPagePng = { pageNumber: number; base64Png: string; bytes: number };

export async function renderPdfToPngs(
  pdfBase64: string,
  opts: { maxPages?: number; scale?: number } = {}
): Promise<PdfPagePng[]> {
  const cleaned = pdfBase64.includes(",") ? pdfBase64.split(",")[1] : pdfBase64;
  const data = new Uint8Array(Buffer.from(cleaned, "base64"));

  const loadingTask = (pdfjsLib as any).getDocument({
    data,
    // Don't try to load standard fonts from disk — credit reports rarely need them
    // and they'd fail on the Railway image.
    disableFontFace: true,
    isEvalSupported: false,
    useSystemFonts: false,
  });
  const pdf = await loadingTask.promise;

  const totalPages = pdf.numPages;
  const maxPages = Math.min(opts.maxPages ?? 12, totalPages);
  const scale = opts.scale ?? 1.5; // 1.5 = ~108dpi at letter; good enough for vision OCR

  const out: PdfPagePng[] = [];
  for (let pageNumber = 1; pageNumber <= maxPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const ctx = canvas.getContext("2d");
    // pdfjs expects a 2D context-like object. Cast to any to bridge type mismatch
    // between @napi-rs/canvas and pdfjs's CanvasRenderingContext2D.
    await page.render({ canvasContext: ctx as any, viewport, canvas: canvas as any }).promise;
    // Encode as PNG (lossless, keeps text crisp for the vision model)
    const buf = canvas.toBuffer("image/png");
    out.push({
      pageNumber,
      base64Png: buf.toString("base64"),
      bytes: buf.byteLength,
    });
    // Free per-page resources promptly
    page.cleanup?.();
  }
  try {
    await pdf.cleanup?.();
    await pdf.destroy?.();
  } catch {}
  return out;
}
