// Puente con Rust para WebSockets: invoke + un único listener de eventos (la red la hace Rust).
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface WsConnectArgs {
  id: string;
  url: string;
  headers: [string, string][];
  subprotocols: string[];
  settings: { handshakeTimeoutSecs: number; verifySsl: boolean; pingIntervalSecs: number };
}
export interface WsOpened { status: number; headers: [string, string][]; protocol: string | null }

export type WsEvent =
  | { id: string; type: "message"; kind: "text" | "binary"; data: string; size: number }
  | { id: string; type: "ping" | "pong"; data: string; size: number }
  | { id: string; type: "close"; code: number; reason: string }
  | { id: string; type: "error"; message: string };

export const wsConnect = (args: WsConnectArgs) => invoke<WsOpened>("ws_connect", { args });
export const wsSend = (id: string, kind: "text" | "binary" | "ping", data: string) => invoke<number>("ws_send", { id, kind, data });
export const wsClose = (id: string, code?: number, reason?: string) => invoke<void>("ws_close", { id, code, reason });
export const onWsEvent = (cb: (e: WsEvent) => void): Promise<UnlistenFn> => listen<WsEvent>("ws://event", (e) => cb(e.payload));
