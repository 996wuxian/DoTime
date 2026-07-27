import { invoke } from "@tauri-apps/api/core";

export async function setWindowOpacity(opacity: number) {
  try {
    await invoke("set_window_opacity", { opacity });
  } catch {
    /* browser */
  }
}
