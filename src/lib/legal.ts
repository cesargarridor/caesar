/** Enlaces legales (publicados en GitHub Pages desde el repo caesar-legal) y marca de primera vez. */
const SITE = "https://cesargarridor.github.io/caesar-legal";
export const PRIVACY_URL = `${SITE}/privacy.html`;
export const TERMS_URL = `${SITE}/terms.html`;
export const REFUND_URL = `${SITE}/refunds.html`;
export const DELETE_URL = `${SITE}/delete.html`;

/** Versión vigente de los Términos y la Política de privacidad. Súbela cuando cambien: la app volverá a pedir aceptación. */
export const TERMS_VERSION = "2026-11-13";
const TERMS_KEY = "caesar.terms";
const SENT_KEY = "caesar.termsSent";

/** Registro local de aceptación: { version, at (ISO), age14 }. null si no hay. */
export const acceptedTerms = (): { version: string; at: string; age14: boolean } | null => {
  try {
    const v = JSON.parse(localStorage.getItem(TERMS_KEY) ?? "null");
    return v && typeof v.version === "string" ? v : null;
  } catch {
    return null;
  }
};
/** ¿Ya aceptó la versión vigente? Sin almacenamiento no podemos recordarlo: no insistir. */
export const termsAccepted = () => {
  try {
    return acceptedTerms()?.version === TERMS_VERSION;
  } catch {
    return true;
  }
};
export const acceptTerms = () => {
  try {
    localStorage.setItem(TERMS_KEY, JSON.stringify({ version: TERMS_VERSION, at: new Date().toISOString(), age14: true }));
    window.dispatchEvent(new Event("caesar-terms"));
  } catch {
    /* sin almacenamiento */
  }
};
/** Para qué cuenta y versión ya se registró la aceptación en el servidor. */
export const termsSentFor = () => { try { return localStorage.getItem(SENT_KEY); } catch { return null; } };
export const markTermsSent = (email: string) => { try { localStorage.setItem(SENT_KEY, `${email}|${TERMS_VERSION}`); } catch { /* nada */ } };
export const termsSentKey = (email: string) => `${email}|${TERMS_VERSION}`;

const ONBOARDED_KEY = "caesar.onboarded";
export const isOnboarded = () => {
  try {
    return localStorage.getItem(ONBOARDED_KEY) !== null;
  } catch {
    return true; // sin almacenamiento no podemos recordarlo: no insistir
  }
};
export const markOnboarded = () => {
  try {
    localStorage.setItem(ONBOARDED_KEY, "1");
  } catch {
    /* sin almacenamiento */
  }
};
