import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { accountState, onAccountLinked, openUrl, syncCheckoutUrl, type AccountMode, type AccountState } from "../api";
import { useToast } from "../components/Toast";
import { t } from "./i18n";

const GUEST: AccountState = { mode: "guest", is_pro: false, whitelisted: false, days_left: 0, deleted: false, email: "" };

interface AccountApi {
  account: AccountState;
  /** Vuelve a leer el estado (sin red). */
  refresh: () => Promise<AccountState>;
  setAccount: (a: AccountState) => void;
}
const Ctx = createContext<AccountApi>({ account: GUEST, refresh: async () => GUEST, setAccount: () => {} });

/** Estado de cuenta (invitado / limbo / pro) accesible en toda la app. También avisa cuando una cuenta se vincula sola. */
export function AccountProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const [account, setAccount] = useState<AccountState>(GUEST);
  const refresh = useCallback(async () => {
    try {
      const a = await accountState();
      setAccount(a);
      return a;
    } catch {
      return GUEST;
    }
  }, []);
  useEffect(() => {
    void refresh();
    const un = onAccountLinked(() => {
      toast.show(t("Cuenta vinculada automáticamente"), "ok");
      void refresh();
    });
    return () => { void un.then((f) => f()).catch(() => {}); };
  }, [refresh, toast]);
  const api = useMemo(() => ({ account, refresh, setAccount }), [account, refresh]);
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export const useAccount = () => useContext(Ctx);

/** Abre en el navegador la página de pago de Pro. */
export const openCheckout = async () => openUrl(await syncCheckoutUrl());

/** Mensaje claro para los errores de plan que devuelve Rust. null = no es uno de ellos. */
export function planError(e: unknown): string | null {
  const m = typeof e === "string" ? e : e instanceof Error ? e.message : "";
  if (m.startsWith("PRO_REQUIRED")) return t("Esta función requiere el plan Pro.");
  if (m.startsWith("GUEST_LIMIT_WORKSPACES")) return t("El modo Invitado permite un solo espacio de trabajo. Pásate a Pro para crear más.");
  return null;
}

export type { AccountMode };
