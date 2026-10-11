import { useEffect, useRef } from "react";
import type { useAppUpdates } from "../hooks/useAppUpdates";
import { formatDownloadSize } from "../utils/appUpdates";
import { IconCircleCheck, IconDownload } from "./icons";

export function AppUpdateSettings({ updates }: { updates: ReturnType<typeof useAppUpdates> }) {
  const { status, info, downloaded, progress, error } = updates;
  const sectionRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (status !== "idle") sectionRef.current?.scrollIntoView({ block: "nearest" });
  }, [status]);
  const busy = status === "checking" || status === "downloading";
  const percent = progress && progress.totalBytes > 0
    ? Math.min(99, Math.floor(progress.downloadedBytes / progress.totalBytes * 100))
    : 0;
  const message = status === "checking"
    ? "正在检查 GitHub 最新版本…"
    : status === "current"
      ? "当前已是最新版本"
      : info?.hasUpdate
        ? `发现新版本 v${info.latestVersion}`
        : "手动检查 GitHub 上的最新正式版本";

  return (
    <section ref={sectionRef} className="settings-update" aria-labelledby="settings-update-title">
      <div className="settings-update__heading">
        <div>
          <h3 id="settings-update-title">版本更新</h3>
          <p>当前版本 v{__APP_VERSION__}</p>
        </div>
        <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void updates.check()}>
          {status === "checking" ? "检查中…" : "检查更新"}
        </button>
      </div>

      <div className={`settings-update__status ${status === "current" ? "is-current" : ""}`} role="status" aria-live="polite">
        {status === "current" && <IconCircleCheck size={16} />}
        <span>{message}</span>
      </div>

      {info?.hasUpdate && status !== "downloaded" && (
        <p className="settings-update__hint">
          {info.assetName
            ? `安装包${info.assetSize ? ` ${formatDownloadSize(info.assetSize)}` : ""} · 保存到下载目录中的 doTime 文件夹`
            : "暂未提供适合当前系统的安装包，请前往 GitHub 发布页选择下载。"}
        </p>
      )}

      {status === "downloading" && (
        <div className="settings-update__progress">
          <div><span>正在下载…</span><span>{percent}%</span></div>
          <progress aria-label="安装包下载进度" max={100} value={percent} />
          <small>下载完成后运行安装包即可更新，关闭设置后下载会继续。</small>
        </div>
      )}

      {downloaded && status === "downloaded" && (
        <div className="settings-update__downloaded" role="status">
          <p><IconCircleCheck size={16} />安装包已下载</p>
          <span title={downloaded.filePath}>{downloaded.fileName}</span>
          <small>打开下载文件夹，运行安装包完成更新。</small>
        </div>
      )}

      {error && <p className="settings-update__error" role="alert">{error}</p>}

      <div className="settings-update__actions">
        {info?.hasUpdate && info.assetName && status !== "downloaded" && (
          <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void updates.download()}>
            <IconDownload size={15} />
            {status === "downloading" ? "正在下载…" : status === "error" ? "重试下载" : "下载新版本"}
          </button>
        )}
        {status === "downloaded" && (
          <button type="button" className="btn btn-primary btn-sm" onClick={() => void updates.openDownloadDirectory()}>
            打开下载文件夹
          </button>
        )}
        <button type="button" className="settings-update__link" onClick={() => void updates.openReleasePage()}>
          前往 GitHub 下载
        </button>
      </div>
    </section>
  );
}
