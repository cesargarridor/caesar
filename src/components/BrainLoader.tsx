import { useEffect, useRef } from "react";
import StepList from "./StepList";
import type { StepState } from "../types";
import { t } from "../lib/i18n";

const PALETTE = ["#8052ff", "#8052ff", "#a78bff", "#ffb829", "#3ccfae", "#ff4fd8", "#4f8cff", "#ffffff"];

interface P {
  x: number; y: number; z: number; c: string; s: number; rot: number; ph: number;
}

function gauss() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Nube de puntos con forma de cerebro: cerebro (elipsoide con surcos y fisura) + cerebelo. */
function makeBrain(n: number): P[] {
  const pts: P[] = [];
  for (let i = 0; i < n; i++) {
    const cerebellum = Math.random() < 0.13;
    let ux = gauss(), uy = gauss(), uz = gauss();
    const l = Math.hypot(ux, uy, uz) || 1;
    ux /= l; uy /= l; uz /= l;
    const shell = Math.random() < 0.82 ? 1 : Math.cbrt(Math.random());
    const gyri = 1 + 0.075 * Math.sin(7 * ux + 2) * Math.sin(7 * uy) * Math.sin(7 * uz + 1);
    const r = shell * gyri;
    let x: number, y: number, z: number;
    if (cerebellum) {
      x = 0.55 + 0.5 * ux * r;
      y = -0.78 + 0.3 * uy * r;
      z = 0.42 * uz * r;
    } else {
      x = 1.3 * ux * r;
      y = 0.12 + 0.88 * uy * r;
      z = 0.95 * uz * r;
      if (Math.abs(z) < 0.07) z += (z >= 0 ? 1 : -1) * 0.07; // fisura longitudinal
    }
    pts.push({
      x, y, z,
      c: PALETTE[Math.floor(Math.random() * PALETTE.length)],
      s: 1.6 + Math.random() * 2.6,
      rot: Math.random() * Math.PI * 2,
      ph: Math.random() * Math.PI * 2,
    });
  }
  return pts;
}

/** Overlay de carga: cerebro de triángulos "pensando" con los pasos de la petición en el centro. */
export default function BrainLoader({ steps }: { steps: StepState[] }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const brain = makeBrain(1500);
    const ambient = Array.from({ length: 140 }, () => ({
      x: Math.random(), y: Math.random(), c: PALETTE[Math.floor(Math.random() * PALETTE.length)],
      s: 1.5 + Math.random() * 2, rot: Math.random() * 6, vx: (Math.random() - 0.5) * 0.00006, vy: (Math.random() - 0.5) * 0.00006,
    }));
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let w = 0, h = 0, raf = 0, angle = 0.6;
    const t0 = performance.now();

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

    const tri = (x: number, y: number, s: number, rot: number) => {
      ctx.beginPath();
      for (let k = 0; k < 3; k++) {
        const a = rot + (k * 2 * Math.PI) / 3;
        const px = x + Math.cos(a) * s, py = y + Math.sin(a) * s;
        if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.stroke();
    };

    const frame = (now: number) => {
      const t = (now - t0) / 1000;
      ctx.clearRect(0, 0, w, h);
      ctx.lineWidth = 1;

      for (const a of ambient) {
        a.x = (a.x + a.vx * 16 + 1) % 1;
        a.y = (a.y + a.vy * 16 + 1) % 1;
        ctx.globalAlpha = 0.22;
        ctx.strokeStyle = a.c;
        tri(a.x * w, a.y * h, a.s, a.rot + t * 0.2);
      }

      const R = Math.min(w, h) * 0.27;
      const cx = w / 2, cy = h / 2;
      const ca = Math.cos(angle), sa = Math.sin(angle);
      for (const p of brain) {
        const x = p.x * ca + p.z * sa;
        const z = -p.x * sa + p.z * ca;
        const f = 1 + z * 0.16;
        // ondas de actividad que recorren el cerebro
        const pulse = 0.55 + 0.45 * Math.sin(t * 2.4 + x * 2.6 + p.ph * 0.35);
        ctx.globalAlpha = Math.min(1, (0.25 + 0.5 * ((z + 1.2) / 2.4)) * (0.45 + pulse));
        ctx.strokeStyle = p.c;
        tri(cx + x * R * f, cy - p.y * R * f, p.s * f * (0.8 + 0.4 * pulse), p.rot + t * 0.5);
      }
      ctx.globalAlpha = 1;
      if (!reduce) {
        angle += 0.0055;
        raf = requestAnimationFrame(frame);
      }
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return (
    <div className="loader-overlay absolute inset-0 z-40 bg-deep" role="status" aria-live="polite">
      <canvas ref={ref} className="absolute inset-0 h-full w-full opacity-70" />
      <div className="relative z-10 flex h-full items-center justify-center">
        <div className="w-full max-w-md rounded-2xl bg-deep/80 glass p-8 backdrop-blur-sm">
          <p className="mb-5 text-sm font-semibold uppercase tracking-[0.025em] text-saffron">{t("Pensando…")}</p>
          <StepList steps={steps} />
        </div>
      </div>
    </div>
  );
}
