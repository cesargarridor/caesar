import { useSyncExternalStore } from "react";
import { getVersion, subscribe } from "./keymap";

/** Vuelve a pintar el componente cuando cambian los atajos, las acciones propias o los botones elegidos. */
export function useKeymapVersion(): number {
  return useSyncExternalStore(subscribe, getVersion, getVersion);
}
