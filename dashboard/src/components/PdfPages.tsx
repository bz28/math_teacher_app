import { useEffect, useMemo, useRef, useState } from "react";
import { base64ToBytes, pdfjsLib } from "../lib/pdf";

// Pixel width each page is rasterised at. The canvas is then scaled to its
// column by CSS, so this only sets the sharpness ceiling — wide enough to
// read handwriting on a high-DPI screen without rasterising a poster.
const RENDER_WIDTH_PX = 1200;

/**
 * Every page of a stored PDF, drawn in sequence at column width.
 *
 * A student's submission is often a scanned PDF rather than a photo, and
 * an <img> cannot show one — the case file rendered a broken-image icon
 * where the handwriting should be. Evidence has to be ALL of it, so this
 * draws each page, not a first-page thumbnail. Clicking opens the file in
 * the browser's own viewer through a blob: URL (Chrome blocks top-frame
 * navigation to data: URLs).
 */
export default function PdfPages({ b64, label }: { b64: string; label: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState(false);
  const [rendering, setRendering] = useState(true);
  // atob() throws synchronously on malformed base64 — decode at render and
  // derive the failure, rather than setting state from inside the effect.
  const bytes = useMemo(() => {
    try {
      return base64ToBytes(b64);
    } catch {
      return null;
    }
  }, [b64]);

  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!bytes) return;
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
    // Syncing an external resource (an object URL) into state, once per
    // decoded file; created and revoked by the same effect so the live href
    // is never a revoked URL under StrictMode's double mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPdfUrl(url);
    return () => {
      URL.revokeObjectURL(url);
      setPdfUrl(null);
    };
  }, [bytes]);

  useEffect(() => {
    const container = containerRef.current;
    if (!bytes || !container) return;
    let cancelled = false;
    // pdf.js transfers the buffer to its worker, so hand it a copy — a
    // re-run would otherwise get a detached buffer.
    const task = pdfjsLib.getDocument({ data: bytes.slice() });
    task.promise
      .then(async (pdf) => {
        const canvases: HTMLCanvasElement[] = [];
        for (let n = 1; n <= pdf.numPages; n++) {
          const page = await pdf.getPage(n);
          if (cancelled) return;
          const base = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: RENDER_WIDTH_PX / base.width });
          const canvas = document.createElement("canvas");
          const ctx = canvas.getContext("2d");
          if (!ctx) throw new Error("no 2d context");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          await page.render({ canvasContext: ctx, viewport }).promise;
          if (cancelled) return;
          canvases.push(canvas);
        }
        container.replaceChildren(...canvases);
        setRendering(false);
      })
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
      task.destroy();
      container.replaceChildren();
    };
  }, [bytes]);

  if (error || bytes === null) {
    return <div className="xq-shot-empty">{label} — PDF could not be displayed.</div>;
  }

  return (
    <a
      className="xq-pdf"
      href={pdfUrl ?? undefined}
      target="_blank"
      rel="noopener noreferrer"
      title="Open the full PDF"
    >
      {rendering && <span className="xq-shot-empty">Rendering {label}…</span>}
      <div ref={containerRef} className="xq-pdf-pages" aria-label={label} role="img" />
    </a>
  );
}
