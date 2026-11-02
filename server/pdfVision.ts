// Render a PDF (as base64) to one JPEG per page using poppler-utils' `pdftoppm`.
//
// Why a subprocess instead of pdfjs + node-canvas?
// - pdfjs-dist + @napi-rs/canvas crashes on credit-report PDFs with
//   `CanvasGraphics.fill: Value is none of these types String, Path` because
//   pdfjs passes Path2D-style arguments that the canvas binding rejects.
// - node-canvas (the alternative) needs Cairo/Pango/libjpeg system libs.
// - pdftoppm is a single apt package (`poppler-utils`), purpose-built for this,
//   handles encoded/CID fonts (Funding Suite, MyFICO), and produces clean PNGs
//   that the vision model reads great.

import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type PdfPageImage = {
  pageNumber: number;
  base64: string;
  mediaType: "image/jpeg";
  bytes: number;
};

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (b) => (stdout += b.toString()));
    child.stderr.on("data", (b) => (stderr += b.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${cmd} exited ${code}: ${stderr.trim() || "(no stderr)"}`));
    });
  });
}

function decode(pdfBase64: string): Buffer {
  const cleaned = pdfBase64.includes(",") ? pdfBase64.split(",")[1] : pdfBase64;
  return Buffer.from(cleaned, "base64");
}

async function withTempPdf<T>(pdfBase64: string, fn: (dir: string, pdfPath: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "cpi-pdf-"));
  const pdfPath = join(dir, "input.pdf");
  try {
    await writeFile(pdfPath, decode(pdfBase64));
    return await fn(dir, pdfPath);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Total page count via poppler's `pdfinfo`. */
export async function countPdfPages(pdfBase64: string): Promise<number | null> {
  return withTempPdf(pdfBase64, async (_dir, pdfPath) => {
    const out = await run("pdfinfo", [pdfPath]);
    const m = out.match(/^Pages:\s+(\d+)/m);
    return m ? parseInt(m[1], 10) : null;
  });
}

/**
 * Render up to `maxPages` pages to JPEG (~150 dpi). JPEG keeps text legible
 * for the vision model at a fraction of PNG's size, which lets long reports
 * fit in one request. Stops early once `maxTotalBytes` would be exceeded.
 */
export async function renderPdfToImages(
  pdfBase64: string,
  opts: { maxPages?: number; dpi?: number; maxTotalBytes?: number } = {},
): Promise<PdfPageImage[]> {
  const maxPages = opts.maxPages ?? 40;
  const dpi = opts.dpi ?? 150;
  const maxTotalBytes = opts.maxTotalBytes ?? 20 * 1024 * 1024;

  return withTempPdf(pdfBase64, async (dir, pdfPath) => {
    const prefix = join(dir, "page");
    await run("pdftoppm", [
      "-jpeg",
      "-jpegopt", "quality=85",
      "-r", String(dpi),
      "-f", "1",
      "-l", String(maxPages),
      pdfPath,
      prefix,
    ]);

    // pdftoppm zero-pads page numbers when there are many pages; sort numerically.
    const files = (await readdir(dir))
      .map((f) => ({ f, m: f.match(/^page-(\d+)\.jpg$/) }))
      .filter((x) => x.m)
      .map((x) => ({ f: x.f, pageNumber: parseInt(x.m![1], 10) }))
      .sort((a, b) => a.pageNumber - b.pageNumber);

    const out: PdfPageImage[] = [];
    let total = 0;
    for (const { f, pageNumber } of files) {
      const buf = await readFile(join(dir, f));
      const b64 = buf.toString("base64");
      if (out.length > 0 && total + b64.length > maxTotalBytes) break;
      total += b64.length;
      out.push({ pageNumber, base64: b64, mediaType: "image/jpeg", bytes: buf.byteLength });
    }
    return out;
  });
}
