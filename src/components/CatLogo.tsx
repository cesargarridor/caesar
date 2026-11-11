/** Gatito pixel-art (cabeza) para el logo de la barra lateral. */
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

export default function CatLogo({ size = 28 }: { size?: number }) {
  const rects: React.ReactElement[] = [];
  ROWS.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const c = PALETTE[row[x]];
      if (c) rects.push(<rect key={`${x}-${y}`} x={x} y={y} width={1.02} height={1.02} fill={c} />);
    }
  });
  return (
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
  );
}
