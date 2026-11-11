import { useEffect, useRef } from "react";
import StepList from "./StepList";
import type { StepState } from "../types";
import { t } from "../lib/i18n";
import { useNetAnim } from "../lib/prefs";

/** Color de la red según el método de la petición (mismos tonos que la lista). */
const METHOD_RGB: Record<string, [number, number, number]> = {
  GET: [60, 207, 174],
  POST: [255, 184, 41],
  PUT: [185, 162, 255],
  PATCH: [255, 140, 60],
  DELETE: [255, 107, 107],
};
const DEFAULT_RGB: [number, number, number] = [255, 184, 41];

interface Node { x: number; y: number; vx: number; vy: number; glow: number; nb: number[] }
interface Dust { x: number; y: number; vx: number; vy: number; s: number; a: number }
interface Pulse { a: number; b: number; t: number }

const LINK = 0.19; // distancia máxima de enlace (fracción del lado menor)

/**
 * Overlay de carga: enjambre de nodos dorados conectados (la "red" de la API) con pulsos que viajan
 * por los enlaces y polvo de estrellas que sigue suavemente al ratón. El color depende del método.
 */
export default function NetworkLoader({ steps, method }: { steps: StepState[]; method: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const anim = useNetAnim();

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!anim || !canvas || !ctx) return;
    const [R, G, B] = METHOD_RGB[method.toUpperCase()] ?? DEFAULT_RGB;
    const col = (a: number) => `rgba(${R},${G},${B},${Math.max(0, Math.min(1, a))})`;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const nodes: Node[] = Array.from({ length: 64 }, () => ({
      x: Math.random(), y: Math.random(), vx: (Math.random() - 0.5) * 0.00012, vy: (Math.random() - 0.5) * 0.00012, glow: 0, nb: [],
    }));
    const dust: Dust[] = Array.from({ length: 150 }, () => ({
      x: Math.random(), y: Math.random(), vx: 0, vy: 0, s: 0.6 + Math.random() * 1.4, a: 0.25 + Math.random() * 0.5,
    }));
    const pulses: Pulse[] = [];
    let w = 0, h = 0, raf = 0, lastSpawn = 0;
    const mouse = { x: 0.5, y: 0.5, on: false };

    const resize = () => {
      const r = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      w = r.width; h = r.height;
      canvas.width = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.max(1, Math.floor(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const onMove = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      if (!r.width || !r.height) return;
      mouse.x = (e.clientX - r.left) / r.width;
      mouse.y = (e.clientY - r.top) / r.height;
      mouse.on = mouse.x >= 0 && mouse.x <= 1 && mouse.y >= 0 && mouse.y <= 1;
    };
    window.addEventListener("pointermove", onMove);

    const relink = () => {
      const side = Math.min(w, h) || 1;
      nodes.forEach((n) => (n.nb = []));
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const d = Math.hypot((nodes[i].x - nodes[j].x) * w, (nodes[i].y - nodes[j].y) * h) / side;
          if (d < LINK) {
            nodes[i].nb.push(j);
            nodes[j].nb.push(i);
          }
        }
      }
    };

    const spawn = (from?: number) => {
      const a = from ?? Math.floor(Math.random() * nodes.length);
      const nb = nodes[a].nb;
      if (!nb.length) return;
      pulses.push({ a, b: nb[Math.floor(Math.random() * nb.length)], t: 0 });
      nodes[a].glow = 1;
    };

    // Ráfaga inicial: la petición "sale" desde el centro hacia la red.
    let centre = 0, best = 9;
    nodes.forEach((n, i) => {
      const d = Math.hypot(n.x - 0.5, n.y - 0.5);
      if (d < best) { best = d; centre = i; }
    });
    let frameN = 0;

    const frame = (now: number) => {
      ctx.clearRect(0, 0, w, h);
      const side = Math.min(w, h) || 1;

      // nodos: deriva lenta + ligera atracción al ratón
      for (const n of nodes) {
        n.x += n.vx * 16; n.y += n.vy * 16;
        if (n.x < 0 || n.x > 1) n.vx *= -1;
        if (n.y < 0 || n.y > 1) n.vy *= -1;
        if (mouse.on) {
          const dx = mouse.x - n.x, dy = mouse.y - n.y;
          const d = Math.hypot(dx * w, dy * h) / side;
          if (d < 0.25) {
            n.x += dx * 0.0016; n.y += dy * 0.0016;
            n.glow = Math.max(n.glow, (0.25 - d) * 2.2);
          }
        }
        n.x = Math.min(1, Math.max(0, n.x));
        n.y = Math.min(1, Math.max(0, n.y));
      }
      if (frameN % 20 === 0) relink();
      if (frameN === 2) for (let k = 0; k < 4; k++) spawn(centre);
      frameN++;

      // polvo de estrellas: sigue suavemente el rastro del ratón
      for (const d of dust) {
        if (mouse.on) {
          const dx = mouse.x - d.x, dy = mouse.y - d.y;
          const dist = Math.hypot(dx, dy) + 0.02;
          d.vx += (dx / dist) * 0.00004 + (Math.random() - 0.5) * 0.00003;
          d.vy += (dy / dist) * 0.00004 + (Math.random() - 0.5) * 0.00003;
        } else {
          d.vx += (Math.random() - 0.5) * 0.00004;
          d.vy += (Math.random() - 0.5) * 0.00004;
        }
        d.vx *= 0.97; d.vy *= 0.97;
        d.x = (d.x + d.vx * 16 + 1) % 1;
        d.y = (d.y + d.vy * 16 + 1) % 1;
        ctx.fillStyle = col(d.a * 0.7);
        ctx.beginPath();
        ctx.arc(d.x * w, d.y * h, d.s, 0, Math.PI * 2);
        ctx.fill();
      }

      // enlaces
      ctx.lineWidth = 1;
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        for (const j of a.nb) {
          if (j < i) continue;
          const b = nodes[j];
          const d = Math.hypot((a.x - b.x) * w, (a.y - b.y) * h) / side;
          ctx.strokeStyle = col((1 - d / LINK) * 0.28 + Math.max(a.glow, b.glow) * 0.25);
          ctx.beginPath();
          ctx.moveTo(a.x * w, a.y * h);
          ctx.lineTo(b.x * w, b.y * h);
          ctx.stroke();
        }
      }

      // pulsos viajando por los enlaces
      if (!reduce && now - lastSpawn > 260 && pulses.length < 26) {
        lastSpawn = now;
        spawn();
      }
      for (let k = pulses.length - 1; k >= 0; k--) {
        const p = pulses[k];
        p.t += 0.03;
        const a = nodes[p.a], b = nodes[p.b];
        if (p.t >= 1) {
          b.glow = 1;
          pulses.splice(k, 1);
          if (b.nb.length) {
            const next = b.nb.filter((n) => n !== p.a);
            const pick = next.length ? next[Math.floor(Math.random() * next.length)] : p.a;
            if (Math.random() < 0.85) pulses.push({ a: p.b, b: pick, t: 0 });
            if (Math.random() < 0.12 && next.length > 1) pulses.push({ a: p.b, b: next[Math.floor(Math.random() * next.length)], t: 0 });
          }
          continue;
        }
        const x = (a.x + (b.x - a.x) * p.t) * w, y = (a.y + (b.y - a.y) * p.t) * h;
        const g = ctx.createRadialGradient(x, y, 0, x, y, 9);
        g.addColorStop(0, col(0.95));
        g.addColorStop(1, col(0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, 9, 0, Math.PI * 2);
        ctx.fill();
      }

      // nodos con brillo
      for (const n of nodes) {
        n.glow *= 0.94;
        const x = n.x * w, y = n.y * h;
        if (n.glow > 0.05) {
          const g = ctx.createRadialGradient(x, y, 0, x, y, 14);
          g.addColorStop(0, col(0.55 * n.glow));
          g.addColorStop(1, col(0));
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(x, y, 14, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = col(0.55 + n.glow * 0.45);
        ctx.beginPath();
        ctx.arc(x, y, 2 + n.glow * 1.6, 0, Math.PI * 2);
        ctx.fill();
      }

      if (!reduce) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("pointermove", onMove);
    };
  }, [method, anim]);

  return (
    <div className="loader-overlay absolute inset-0 z-40 bg-deep" role="status" aria-live="polite">
      {anim && <canvas ref={ref} className="absolute inset-0 h-full w-full" />}
      <div className="relative z-10 flex h-full items-center justify-center">
        <div className="w-full max-w-md rounded-2xl bg-deep/80 glass p-8 backdrop-blur-sm">
          <p className="mb-5 text-sm font-semibold uppercase tracking-[0.025em] text-saffron">{t("Pensando…")}</p>
          <StepList steps={steps} />
        </div>
      </div>
    </div>
  );
}
