import { useEffect, useState } from "react";
import type { useAutomaticBackup } from "../hooks/useAutomaticBackup";
import { formatAutomaticBackupError } from "../data/automaticBackup";
import "./AutomaticBackupSettings.css";

export type AutomaticBackupController = ReturnType<typeof useAutomaticBackup>;
const formatTime = (time: number) => new Date(time).toLocaleString("zh-CN", { hour12: false });

export function AutomaticBackupSettings({ backup, blocked = false }: { backup: AutomaticBackupController; blocked?: boolean }) {
  const { status } = backup;
  const [enabled, setEnabled] = useState(true);
  const [directory, setDirectory] = useState("");
  const [keepCount, setKeepCount] = useState<7 | 30>(7);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (!status) return;
    setEnabled(status.enabled);
    setDirectory(status.directory);
    setKeepCount(status.keepCount);
  }, [status?.enabled, status?.directory, status?.keepCount]);
  const busy = blocked || backup.running || backup.saving || backup.loading;
  const disabled = !backup.supported || !status || busy;
  const dirty = !!status && (enabled !== status.enabled || directory.trim() !== status.directory || keepCount !== status.keepCount);
  const failure = backup.error || status?.lastError;
  return (
    <details className="automatic-backup-settings">
      <summary><span>自动文件备份</span><strong className={failure ? "is-error" : ""}>{backup.running ? "正在备份…" : backup.loading ? "读取设置…" : failure ? "备份失败" : status?.enabled ? "每天一次" : backup.supported ? "未开启" : "桌面端可用"}</strong></summary>
      <div className="automatic-backup-settings__body">
        <p>包含待办、回收站、模板和图片。应用运行时每天备份；关闭期间错过的备份，会在下次启动时补做。</p>
        {!backup.supported && <p>请在 doTime 桌面应用中设置自动文件备份。</p>}
        <label className="automatic-backup-settings__switch"><input type="checkbox" checked={enabled} disabled={disabled} onChange={event => setEnabled(event.target.checked)} />每天自动备份</label>
        <label className="automatic-backup-settings__field"><span>备份文件夹</span><input aria-label="自动备份文件夹" placeholder="例如 D:\DoTime备份" value={directory} disabled={disabled} spellCheck={false} onChange={event => setDirectory(event.target.value)} /></label>
        <div className="automatic-backup-settings__row"><label>保留最近 <select aria-label="自动备份保留数量" value={keepCount} disabled={disabled} onChange={event => setKeepCount(Number(event.target.value) as 7 | 30)}><option value={7}>7 份</option><option value={30}>30 份</option></select></label><button type="button" className="btn btn-ghost btn-sm" disabled={disabled || !status} onClick={() => { if (status) setDirectory(status.defaultDirectory); }}>使用默认目录</button></div>
        <p className="automatic-backup-settings__hint">新备份成功后按保留数量轮换，其他文件会保留。可选择其他磁盘或文件夹。</p>
        <div className="automatic-backup-settings__actions"><button type="button" className="btn btn-primary btn-sm" disabled={disabled || !dirty || !directory.trim()} onClick={() => {
          void backup.save({ enabled, directory: directory.trim(), keepCount }).then(result => setNotice(result.error ? "" : result.created ? "设置已保存，备份已完成。" : "设置已保存。"));
        }}>{backup.saving ? "保存中…" : "保存设置"}</button><button type="button" className="btn btn-secondary btn-sm" disabled={disabled || dirty} onClick={() => { setNotice(""); void backup.backupNow().then(result => setNotice(result.created ? "备份已完成。" : result.error ? "" : "稍后重试，当前可能正在恢复数据。")); }}>{backup.running ? "正在备份…" : "立即备份"}</button><button type="button" className="btn btn-ghost btn-sm" disabled={disabled || dirty} onClick={() => { void backup.openDirectory().catch(failure => setNotice(`无法打开目录：${formatAutomaticBackupError(failure)}`)); }}>打开目录</button></div>
        {dirty && <p>修改尚未保存。</p>}
        <p>最近成功：{status?.lastSuccessAt ? formatTime(status.lastSuccessAt) : "尚未完成备份"}</p>
        {status?.lastBackupFile && <p className="automatic-backup-settings__path" title={status.lastBackupFile}>{status.lastBackupFile}</p>}
        {failure && <p className="automatic-backup-settings__error" role="alert">{failure}。可立即重试，自动重试间隔为 30 分钟。</p>}
        {status?.lastWarning && <p role="status">备份已保存，但旧备份轮换未完成：{status.lastWarning}</p>}
        {notice && <p role="status">{notice}</p>}
        <p>恢复时点击上方“从备份恢复”，选择文件夹中的 JSON 备份。</p>
      </div>
    </details>
  );
}
