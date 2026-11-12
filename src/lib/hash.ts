// Funciones hash/HMAC para las firmas de autenticación. SHA-1/SHA-256 usan WebCrypto; MD4 y MD5 (que WebCrypto no
// tiene) están escritas a mano: solo las necesitan Digest y NTLM, que las exigen por protocolo.

export const utf8 = (s: string) => new TextEncoder().encode(s);

export const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

export function toBase64(b: Uint8Array): string {
  let bin = "";
  b.forEach((x) => (bin += String.fromCharCode(x)));
  return btoa(bin);
}

export function fromBase64(s: string): Uint8Array {
  const bin = atob(s.trim());
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function randomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n));
}

type Sha = "SHA-1" | "SHA-256";

export async function sha(alg: Sha, data: Uint8Array | string): Promise<Uint8Array> {
  const bytes = typeof data === "string" ? utf8(data) : data;
  return new Uint8Array(await crypto.subtle.digest(alg, bytes as BufferSource));
}

export async function hmacSha(alg: Sha, key: Uint8Array | string, data: Uint8Array | string): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey("raw", (typeof key === "string" ? utf8(key) : key) as BufferSource, { name: "HMAC", hash: alg }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, (typeof data === "string" ? utf8(data) : data) as BufferSource));
}

// ───────────── MD4 / MD5 ─────────────

const rol = (x: number, n: number) => (x << n) | (x >>> (32 - n));

/** Relleno común de MD4/MD5: 0x80, ceros y longitud en bits (little-endian de 64 bits). */
function pad(msg: Uint8Array): Uint8Array {
  const len = msg.length;
  const total = (((len + 8) >> 6) + 1) << 6;
  const out = new Uint8Array(total);
  out.set(msg);
  out[len] = 0x80;
  const dv = new DataView(out.buffer);
  dv.setUint32(total - 8, (len << 3) >>> 0, true);
  dv.setUint32(total - 4, Math.floor(len / 0x20000000), true);
  return out;
}

function digestOut(a: number, b: number, c: number, d: number): Uint8Array {
  const out = new Uint8Array(16);
  const dv = new DataView(out.buffer);
  [a, b, c, d].forEach((v, i) => dv.setUint32(i * 4, v >>> 0, true));
  return out;
}

export function md4(msg: Uint8Array): Uint8Array {
  const data = pad(msg);
  const dv = new DataView(data.buffer);
  let a = 0x67452301, b = 0xefcdab89 | 0, c = 0x98badcfe | 0, d = 0x10325476;
  const x = new Array<number>(16);
  for (let off = 0; off < data.length; off += 64) {
    for (let i = 0; i < 16; i++) x[i] = dv.getUint32(off + i * 4, true);
    const [aa, bb, cc, dd] = [a, b, c, d];
    const F = (p: number, q: number, r: number) => (p & q) | (~p & r);
    const G = (p: number, q: number, r: number) => (p & q) | (p & r) | (q & r);
    const H = (p: number, q: number, r: number) => p ^ q ^ r;
    for (const i of [0, 4, 8, 12]) {
      a = rol((a + F(b, c, d) + x[i]) | 0, 3);
      d = rol((d + F(a, b, c) + x[i + 1]) | 0, 7);
      c = rol((c + F(d, a, b) + x[i + 2]) | 0, 11);
      b = rol((b + F(c, d, a) + x[i + 3]) | 0, 19);
    }
    for (const i of [0, 1, 2, 3]) {
      a = rol((a + G(b, c, d) + x[i] + 0x5a827999) | 0, 3);
      d = rol((d + G(a, b, c) + x[i + 4] + 0x5a827999) | 0, 5);
      c = rol((c + G(d, a, b) + x[i + 8] + 0x5a827999) | 0, 9);
      b = rol((b + G(c, d, a) + x[i + 12] + 0x5a827999) | 0, 13);
    }
    for (const i of [0, 2, 1, 3]) {
      a = rol((a + H(b, c, d) + x[i] + 0x6ed9eba1) | 0, 3);
      d = rol((d + H(a, b, c) + x[i + 8] + 0x6ed9eba1) | 0, 9);
      c = rol((c + H(d, a, b) + x[i + 4] + 0x6ed9eba1) | 0, 11);
      b = rol((b + H(c, d, a) + x[i + 12] + 0x6ed9eba1) | 0, 15);
    }
    a = (a + aa) | 0; b = (b + bb) | 0; c = (c + cc) | 0; d = (d + dd) | 0;
  }
  return digestOut(a, b, c, d);
}

const MD5_S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
const MD5_K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) | 0);

export function md5(msg: Uint8Array): Uint8Array {
  const data = pad(msg);
  const dv = new DataView(data.buffer);
  let a0 = 0x67452301, b0 = 0xefcdab89 | 0, c0 = 0x98badcfe | 0, d0 = 0x10325476;
  for (let off = 0; off < data.length; off += 64) {
    let a = a0, b = b0, c = c0, d = d0;
    for (let i = 0; i < 64; i++) {
      let f: number, g: number;
      if (i < 16) { f = (b & c) | (~b & d); g = i; }
      else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) % 16; }
      else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) % 16; }
      else { f = c ^ (b | ~d); g = (7 * i) % 16; }
      const tmp = d;
      d = c;
      c = b;
      b = (b + rol((a + f + MD5_K[i] + dv.getUint32(off + g * 4, true)) | 0, MD5_S[(i >> 4) * 4 + (i % 4)])) | 0;
      a = tmp;
    }
    a0 = (a0 + a) | 0; b0 = (b0 + b) | 0; c0 = (c0 + c) | 0; d0 = (d0 + d) | 0;
  }
  return digestOut(a0, b0, c0, d0);
}

export function hmacMd5(key: Uint8Array, data: Uint8Array): Uint8Array {
  let k = key.length > 64 ? md5(key) : key;
  k = concat(k, new Uint8Array(64 - k.length));
  const ipad = k.map((x) => x ^ 0x36);
  const opad = k.map((x) => x ^ 0x5c);
  return md5(concat(opad, md5(concat(ipad, data))));
}
