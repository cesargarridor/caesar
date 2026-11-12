// ÚNICO punto de contacto con el exterior: IPC hacia Rust. Sin fetch(), sin XHR, sin WebSocket.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { BodyData, ImportedCollection, KV, ResponseData, Settings } from "./types";

export const importPostmanCollection = () =>
  invoke<ImportedCollection | null>("import_postman_collection");

export const executeRequest = (args: {
  method: string;
  url: string;
  headers: KV[];
  body: BodyData;
  settings: Settings;
  /** Misma sesión = misma conexión HTTP (NTLM). */
  session?: string;
}) => invoke<ResponseData>("execute_request", { args });

export const openUrl = (url: string) => invoke<void>("open_url", { url });

export interface PickedFile { path: string; name: string; size: number }
export const pickFile = () => invoke<PickedFile | null>("pick_file");

export const saveTextFile = (suggestedName: string, content: string, ext?: string) =>
  invoke<string | null>("save_text_file", { suggestedName, content, ext });

export interface TextFile { name: string; content: string }
export const pickTextFile = () => invoke<TextFile | null>("pick_text_file");
export const parsePostmanContent = (content: string) => invoke<ImportedCollection>("parse_postman_content", { content });

// Colecciones de equipo (compartidas por código; Rust cifra y habla con Firebase).
export interface TeamDoc { json: string; updatedAt: number; owner: boolean }
export const teamPublish = (json: string) => invoke<string>("team_publish", { json });
export const teamJoin = (code: string) => invoke<TeamDoc>("team_join", { code });
export const teamPush = (code: string, json: string) => invoke<number>("team_push", { code, json });
export const teamPull = (code: string, since: number) => invoke<TeamDoc | null>("team_pull", { code, since });
export const teamUnshare = (code: string) => invoke<void>("team_unshare", { code });

// Sincronización cifrada (Rust cifra y habla con Firebase; la interfaz nunca ve la clave).
export interface SyncStatus {
  configured: boolean;
  github: boolean;
  billing: boolean;
  blocked: boolean;
  signed_in: boolean;
  email: string;
  has_key: boolean;
  dirty: boolean;
  last_sync: number;
  error: string | null;
}
export const syncStatus = () => invoke<SyncStatus>("sync_status");
export const localSave = (json: string) => invoke<void>("local_save", { json });
export const syncSignIn = (email: string, password: string, create: boolean) =>
  invoke<void>("sync_sign_in", { email, password, create });
export interface DeviceCode { user_code: string; verification_uri: string; device_code: string; interval: number; expires_in: number }
export const syncGithubBegin = () => invoke<DeviceCode>("sync_github_begin");
export const syncGithubFinish = (d: DeviceCode) =>
  invoke<void>("sync_github_finish", { deviceCode: d.device_code, interval: d.interval, expiresIn: d.expires_in });
export interface Billing { active: boolean; status: string; ends_at: number; portal: string }
export const syncBilling = () => invoke<Billing>("sync_billing");
export const syncCheckoutUrl = () => invoke<string>("sync_checkout_url");
export const syncDeleteAccount = () => invoke<void>("sync_delete_account");
export const syncSignOut = () => invoke<void>("sync_sign_out");
export const syncNow = () => invoke<void>("sync_now");
export const vaultCreate = () => invoke<string>("vault_create");
export const vaultRestore = (recovery: string) => invoke<void>("vault_restore", { recovery });
export const vaultRecovery = () => invoke<string>("vault_recovery");
export const vaultRotate = () => invoke<string>("vault_rotate");
export const vaultReplace = (recovery: string) => invoke<void>("vault_replace", { recovery });
export const onSyncRemote = (cb: (json: string) => void) => listen<string>("sync-remote", (e) => cb(e.payload));

// Actualizaciones: la red la hace Rust (paquetes firmados); aquí solo se invocan los comandos.
export interface UpdateInfo { version: string; current: string; notes: string | null }
export const appVersion = () => invoke<string>("app_version");
export const checkUpdate = () => invoke<UpdateInfo | null>("check_update");
export const installUpdate = () => invoke<void>("install_update");
export const onUpdateProgress = (cb: (p: { downloaded: number; total: number | null }) => void) =>
  listen<{ downloaded: number; total: number | null }>("update-progress", (e) => cb(e.payload));
