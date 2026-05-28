// Render a PDF (as base64) to one PNG per page, returning each page as base64.
// Uses pdfjs-dist + @napi-rs/canvas so there are no system dependencies on Railway.
// Works on PDFs with encoded/CID fonts (e.g. Funding Suite mortgage reports)
// because we render visually and let the vision model read the images.

import { createCanvas } from "@napi-rs/canvas";

// pdfjs-dist v5 is ESM-only. esbuild bundles us into CJS, so a static
// `import` would get rewritten to require() and crash at runtime with
// ERR_REQUIRE_ESM. Use a real dynamic import() — esbuild leaves these
// alone in CJS output, so Node can load the ESM module at runtime.
let pdfjsLibPromise: Promise<any> | null = null;
async function loadPdfjs(): Promise<any> {
  if (!pdfjsLibPromise) {
    pdfjsLibPromise = (async () => {
      // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
      const dynImport: (s: string) => Promise<any> = new Function("s", "return import(s)") as any;
      const mod = await dynImport("pdfjs-dist/legacy/build/pdf.mjs");
      // pdfjs v5 will otherwise try to fetch a worker from a CDN that may not
      // match the installed API version (we hit "API 5.6.205 vs Worker 5.4.296").
      // Point workerSrc at the worker file shipped inside the SAME package so
      // versions are guaranteed to match. We resolve via require.resolve so it
      // works regardless of cwd.
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const path = require("node:path");
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { pathToFileURL } = require("node:url");
        const workerPath = require.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs");
        if (mod?.GlobalWorkerOptions) {
          mod.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;
        }
      } catch (e) {
        console.error("[pdfVision] could not resolve pdf.worker.mjs:", e);
      }
      return mod;
    })();
  }
  return pdfjsLibPromise;
}

export type PdfPagePng = { pageNumber: number; base64Png: string; bytes: number };

export async function renderPdfToPngs(
  pdfBase64: string,
  opts: { maxPages?: number; scale?: number } = {}
): Promise<PdfPagePng[]> {
  const cleaned = pdfBase64.includes(",") ? pdfBase64.split(",")[1] : pdfBase64;
  const data = new Uint8Array(Buffer.from(cleaned, "base64"));

  const pdfjsLib = await loadPdfjs();
  const loadingTask = (pdfjsLib as any).getDocument({
    data,
    // Don't try to load standard fonts from disk — credit reports rarely need them
    // and they'd fail on the Railway image.
    disableFontFace: true,
    isEvalSupported: false,
    useSystemFonts: false,
    // Run on the main thread — no separate worker. Avoids version-skew bugs.
    disableWorker: true,
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
