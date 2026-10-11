import { invoke } from "@tauri-apps/api/core";

export const APP_REPOSITORY_URL = "https://github.com/996wuxian/DoTime";
export const APP_DOWNLOAD_URL = `${APP_REPOSITORY_URL}/releases`;
export const UPDATE_PROGRESS_EVENT = "dotime-update-download-progress";

export type UpdateInfo = {
  currentVersion: string;
  latestVersion: string;
  hasUpdate: boolean;
  releaseUrl: string;
  publishedAt: string | null;
  assetName: string | null;
  assetSize: number | null;
};

export type UpdateDownloadProgress = {
  downloadedBytes: number;
  totalBytes: number;
};

export type DownloadedUpdate = {
  fileName: string;
  filePath: string;
};

export function isDesktopApp(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

export function checkForUpdates() {
  if (!isDesktopApp()) {
    return Promise.reject(new Error("请在桌面应用中检查更新，或前往 GitHub 发布页下载。"));
  }
  return invoke<UpdateInfo>("check_for_updates");
}

export function downloadUpdate() {
  return invoke<DownloadedUpdate>("download_update");
}

export async function openUpdateReleasePage(url = APP_DOWNLOAD_URL) {
  if (isDesktopApp()) {
    await invoke("open_external_url", { url });
  } else {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

export function openUpdateDownloadDirectory() {
  return invoke("open_update_download_directory");
}

export function formatDownloadSize(bytes: number) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
