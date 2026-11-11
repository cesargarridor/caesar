// ÚNICO punto de contacto con el exterior: IPC hacia Rust. Sin fetch(), sin XHR, sin WebSocket.
import { invoke } from "@tauri-apps/api/core";
import type { BodyData, ImportedCollection, KV, ResponseData, Settings } from "./types";

export const importPostmanCollection = () =>
  invoke<ImportedCollection | null>("import_postman_collection");

export const executeRequest = (args: {
  method: string;
  url: string;
  headers: KV[];
  body: BodyData;
  settings: Settings;
}) => invoke<ResponseData>("execute_request", { args });

export const openUrl = (url: string) => invoke<void>("open_url", { url });

export interface PickedFile { path: string; name: string; size: number }
export const pickFile = () => invoke<PickedFile | null>("pick_file");

export const saveTextFile = (suggestedName: string, content: string) =>
  invoke<string | null>("save_text_file", { suggestedName, content });
