/** Enlaces legales (páginas publicadas desde docs/ en GitHub Pages) y marca de primera vez. */
const SITE = "https://cesargarridor.github.io/caesar";
export const PRIVACY_URL = `${SITE}/privacy.html`;
export const TERMS_URL = `${SITE}/terms.html`;

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
