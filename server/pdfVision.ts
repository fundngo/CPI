// Render a PDF (as base64) to one PNG per page using poppler-utils' `pdftoppm`.
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

export type PdfPagePng = { pageNumber: number; base64Png: string; bytes: number };

function runPdftoppm(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("pdftoppm", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (b) => (stderr += b.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`pdftoppm exited ${code}: ${stderr.trim() || "(no stderr)"}`));
    });
  });
}

export async function renderPdfToPngs(
  pdfBase64: string,
  opts: { maxPages?: number; scale?: number } = {}
): Promise<PdfPagePng[]> {
  const cleaned = pdfBase64.includes(",") ? pdfBase64.split(",")[1] : pdfBase64;
  const pdfBuffer = Buffer.from(cleaned, "base64");
  const maxPages = opts.maxPages ?? 12;
  // pdftoppm uses -r <dpi>. 150dpi = great for vision OCR, ~1.7M pixels at letter.
  const scale = opts.scale ?? 1.5;
  const dpi = Math.round(72 * scale * 1.4); // ~150dpi at scale 1.5

  const dir = await mkdtemp(join(tmpdir(), "cpi-pdf-"));
  const pdfPath = join(dir, "input.pdf");
  const prefix = join(dir, "page");

  try {
    await writeFile(pdfPath, pdfBuffer);
    await runPdftoppm([
      "-png",
      "-r", String(dpi),
      "-f", "1",
      "-l", String(maxPages),
      pdfPath,
      prefix,
    ]);

    const files = (await readdir(dir))
      .filter((f) => f.startsWith("page-") && f.endsWith(".png"))
      .sort(); // page-1.png, page-2.png, ... page-10.png lexicographic ok up to 99

    const out: PdfPagePng[] = [];
    for (const f of files) {
      // Extract page number from "page-N.png" — pdftoppm zero-pads when there are
      // many pages, so just parse the int.
      const m = f.match(/page-(\d+)\.png$/);
      const pageNumber = m ? parseInt(m[1], 10) : out.length + 1;
      const buf = await readFile(join(dir, f));
      out.push({
        pageNumber,
        base64Png: buf.toString("base64"),
        bytes: buf.byteLength,
      });
    }
    // Sort numerically just in case
    out.sort((a, b) => a.pageNumber - b.pageNumber);
    return out;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
