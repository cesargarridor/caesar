import { useEffect, useRef, useState } from "react";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import { t } from "../lib/i18n";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const MAX_PAGES = 300;

/** Visor de PDF propio (pdf.js): funciona igual en Windows, macOS y Linux, sin depender del visor del WebView. */
export default function PdfView({ b64 }: { b64: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [pages, setPages] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let doc: pdfjs.PDFDocumentProxy | null = null;
    const el = host.current;
    if (!el) return;
    el.replaceChildren();
    setState("loading");
    (async () => {
      try {
        const bin = atob(b64);
        const data = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
        doc = await pdfjs.getDocument({
          data,
          isEvalSupported: false,
          cMapUrl: "/pdfjs/cmaps/",
          cMapPacked: true,
          standardFontDataUrl: "/pdfjs/standard_fonts/",
        }).promise;
        if (cancelled) return;
        const n = Math.min(doc.numPages, MAX_PAGES);
        setPages(doc.numPages);
        const width = Math.max(300, el.clientWidth - 32);
        const dpr = window.devicePixelRatio || 1;
        for (let i = 1; i <= n; i++) {
          const page = await doc.getPage(i);
          if (cancelled) return;
          const base = page.getViewport({ scale: 1 });
          const scale = Math.min(2, width / base.width);
          const vp = page.getViewport({ scale: scale * dpr });
          const canvas = document.createElement("canvas");
          canvas.width = Math.floor(vp.width);
          canvas.height = Math.floor(vp.height);
          canvas.style.width = `${Math.floor(vp.width / dpr)}px`;
          canvas.style.height = `${Math.floor(vp.height / dpr)}px`;
          canvas.className = "mx-auto mb-3 bg-white shadow";
          el.appendChild(canvas);
          await page.render({ canvasContext: canvas.getContext("2d")!, viewport: vp }).promise;
          if (i === 1) setState("ok");
        }
        setState("ok");
      } catch {
        if (!cancelled) setState("error");
      }
    })();
    return () => {
      cancelled = true;
      void doc?.destroy();
    };
  }, [b64]);

  return (
    <div className="h-full overflow-auto bg-kelp/40 p-4">
      {state === "loading" && <p className="text-sm text-slate">{t("Cargando PDF…")}</p>}
      {state === "error" && <p className="text-sm text-rose">{t("No se pudo mostrar el PDF. Usa «Guardar archivo».")}</p>}
      {pages > 300 && <p className="mb-2 text-xs text-slate">{t("Se muestran las primeras 300 páginas. Usa «Guardar archivo» para el resto.")}</p>}
      <div ref={host} />
    </div>
  );
}
