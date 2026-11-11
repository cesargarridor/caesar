import { useEffect, useRef, useState } from "react";
import { useCatAnim } from "../lib/prefs";

/** Gatito pixel-art (cabeza) para el logo. Al hacerle clic cierra los ojos de felicidad y ronronea. */
const PALETTE: Record<string, string> = {
  o: "#f28c2e",
  d: "#c9621a",
  w: "#fff0d4",
  k: "#2b1a12",
  p: "#ff9aa8",
};

const ROWS = [
  "oo............oo",
  "ooo..........ooo",
  "oopo........opoo",
  "oopooooddoooopoo",
  "oooooooddooooooo",
  "oookkoooooookkoo",
  "oookkoooooookkoo",
  "oowwwwoppowwwwoo",
  "oowwwwowwowwwwoo",
  "ooowwwwwwwwwwooo",
  ".oooowwwwwwoooo.",
  "..oooooooooooo..",
];

/** Ojos felices: dos arcos "^ ^" en lugar de los ojos abiertos. */
const HAPPY: Record<number, string> = {
  5: "oookkooooookkooo",
  6: "ookookooookookoo",
};

const HAPPY_MS = 2400;

export default function CatLogo({ size = 28 }: { size?: number }) {
  const anim = useCatAnim();
  const [happy, setHappy] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => {
    if (!anim) setHappy(false);
  }, [anim]);

  const onClick = () => {
    if (!anim) return;
    setHappy(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setHappy(false), HAPPY_MS);
  };

  const rows = happy ? ROWS.map((r, i) => HAPPY[i] ?? r) : ROWS;
  const rects: React.ReactElement[] = [];
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const c = PALETTE[row[x]];
      if (c) rects.push(<rect key={`${x}-${y}`} x={x} y={y} width={1.02} height={1.02} fill={c} />);
    }
  });
  return (
    <span
      className={`cat-wrap relative inline-block ${anim ? "cursor-pointer" : "cat-static"} ${happy ? "cat-happy" : ""}`}
      onClick={onClick}
      title={anim ? "♥" : undefined}
    >
      <svg
        width={size}
        height={(size * ROWS.length) / 16}
        viewBox={`0 0 16 ${ROWS.length}`}
        shapeRendering="crispEdges"
        aria-hidden="true"
        className="cat-logo"
      >
        {rects}
      </svg>
      {happy && (
        <>
          <span className="cat-heart" style={{ left: "10%", animationDelay: "0s" }}>♥</span>
          <span className="cat-heart" style={{ left: "45%", animationDelay: ".35s" }}>♥</span>
          <span className="cat-heart" style={{ left: "78%", animationDelay: ".7s" }}>♥</span>
        </>
      )}
    </span>
  );
}
