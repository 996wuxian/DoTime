import { useCallback, useEffect, useRef, useState } from "react";
import {
  UPDATE_PROGRESS_EVENT,
  checkForUpdates,
  downloadUpdate,
  isDesktopApp,
  openUpdateDownloadDirectory,
  openUpdateReleasePage,
  type DownloadedUpdate,
  type UpdateDownloadProgress,
  type UpdateInfo,
} from "../utils/appUpdates";

type UpdateStatus = "idle" | "checking" | "current" | "available" | "downloading" | "downloaded" | "error";

function errorMessage(error: unknown, fallback: string) {
  return typeof error === "string" ? error : error instanceof Error ? error.message : fallback;
}

export function useAppUpdates() {
  const [status, setStatus] = useState<UpdateStatus>("idle");
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [downloaded, setDownloaded] = useState<DownloadedUpdate | null>(null);
  const [progress, setProgress] = useState<UpdateDownloadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    if (isDesktopApp()) {
      void import("@tauri-apps/api/event").then(async ({ listen }) => {
        const stop = await listen<UpdateDownloadProgress>(UPDATE_PROGRESS_EVENT, (event) => {
          if (!disposed) setProgress(event.payload);
        });
        if (disposed) stop();
        else unlisten = stop;
      }).catch(() => {
        // The download still works when progress events are unavailable.
      });
    }
    return () => {
      disposed = true;
      mounted.current = false;
      unlisten?.();
    };
  }, []);

  const check = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setStatus("checking");
    setInfo(null);
    setDownloaded(null);
    setProgress(null);
    setError(null);
    try {
      const result = await checkForUpdates();
      if (!mounted.current) return;
      setInfo(result);
      setStatus(result.hasUpdate ? "available" : "current");
    } catch (error) {
      if (!mounted.current) return;
      setError(errorMessage(error, "无法检查更新，请前往 GitHub 发布页查看。"));
      setStatus("error");
    } finally {
      busy.current = false;
    }
  }, []);

  useEffect(() => {
    if (isDesktopApp()) void check();
  }, [check]);

  const download = useCallback(async () => {
    if (busy.current || !info?.hasUpdate || !info.assetName) return;
    busy.current = true;
    setStatus("downloading");
    setProgress({ downloadedBytes: 0, totalBytes: info.assetSize ?? 0 });
    setError(null);
    try {
      const result = await downloadUpdate();
      if (!mounted.current) return;
      setDownloaded(result);
      setStatus("downloaded");
    } catch (error) {
      if (!mounted.current) return;
      setError(errorMessage(error, "安装包下载失败，请前往 GitHub 发布页下载。"));
      setStatus("error");
    } finally {
      busy.current = false;
    }
  }, [info]);

  const openReleasePage = useCallback(async () => {
    try {
      await openUpdateReleasePage(info?.releaseUrl);
    } catch {
      if (mounted.current) setError("无法打开浏览器，请访问 github.com/996wuxian/DoTime/releases 下载。");
    }
  }, [info]);

  const openDownloadDirectory = useCallback(async () => {
    try {
      await openUpdateDownloadDirectory();
    } catch (error) {
      if (mounted.current) setError(errorMessage(error, "无法打开下载文件夹。"));
    }
  }, []);

  return { status, info, downloaded, progress, error, check, download, openReleasePage, openDownloadDirectory };
}
