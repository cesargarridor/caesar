#!/usr/bin/env node
// Genera un código de «Pro para siempre» (plan Compas) y dice qué documento crear en Firestore.
//   node cloudflare/gen-code.mjs [usos]      (por defecto 6)
// Alfabeto sin caracteres confusos (sin I, L, O, 0, 1) para que se pueda dictar o copiar sin errores.
import { randomInt } from "node:crypto";

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const group = () => Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
const max = Number(process.argv[2] ?? 6);
if (!Number.isInteger(max) || max < 1) {
  console.error("Uso: node cloudflare/gen-code.mjs [usos]");
  process.exit(1);
}
const code = `CAESAR-${group()}-${group()}-${group()}`;
console.log(`Código: ${code}\n`);
console.log("Créalo en Firebase → Firestore Database → colección «codes»:");
console.log(`  ID del documento: ${code}`);
console.log(`  max   (number): ${max}`);
console.log("  uses  (number): 0");
console.log("\nPara ampliar los usos, cambia «max» en ese documento. «uses» lo sube el Worker solo.");
