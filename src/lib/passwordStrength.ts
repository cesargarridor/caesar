/** Fuerza de una contraseña: 0 (muy débil) a 4 (muy fuerte). Heurística local, sin red. */
export type Strength = 0 | 1 | 2 | 3 | 4;

const COMMON = ["password", "contrasena", "contraseña", "123456", "qwerty", "abc123", "111111", "letmein", "admin", "iloveyou", "caesar", "welcome", "12345678"];

export function passwordStrength(pw: string): Strength {
  if (!pw) return 0;
  const low = pw.toLowerCase();
  if (pw.length < 6 || COMMON.some((c) => low.includes(c) && pw.length <= c.length + 4)) return 0;
  let classes = 0;
  if (/[a-z]/.test(pw)) classes++;
  if (/[A-Z]/.test(pw)) classes++;
  if (/\d/.test(pw)) classes++;
  if (/[^A-Za-z0-9]/.test(pw)) classes++;
  const unique = new Set(pw).size;
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (classes >= 3) score++;
  if (classes >= 4 && pw.length >= 10) score++;
  if (unique <= Math.ceil(pw.length / 3)) score = Math.max(0, score - 2); // «aaaaaa», «121212»…
  if (/^(.)\1+$/.test(pw) || /^(012|123|234|345|456|567|678|789|abc|qwe)/i.test(pw) && pw.length < 10) score = Math.min(score, 1);
  return Math.max(1, Math.min(4, score)) as Strength;
}

export const STRENGTH_LABELS = ["Muy débil", "Débil", "Aceptable", "Fuerte", "Muy fuerte"] as const;
export const STRENGTH_COLORS = ["bg-red-500", "bg-red-500", "bg-orange-400", "bg-lime-400", "bg-green-500"] as const;
