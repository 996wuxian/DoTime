import { useEffect, useRef, useState } from "react";
import { parseAppBackup, type BackupImport } from "../data/appBackup";
import { readRecoveryBackup } from "../data/backupRestore";
import {
  getDataDirectory,
  migrateDataDirectory,
  openDataDirectory,
} from "../data/fileStorage";
import { formatDisplayDate } from "../utils/time";
import {
  IconCalendarEvent,
  IconDatabaseExport,
  IconDeviceFloppy,
  IconDownload,
  IconSettings,
  IconTrash,
  IconUpload,
} from "./icons";
import { ConfirmDialog } from "./ConfirmDialog";
import { ToastNotice } from "./ToastNotice";
import { AutomaticBackupSettings, type AutomaticBackupController } from "./AutomaticBackupSettings";

interface DataActionsProps {
  automaticBackup: AutomaticBackupController;
  notice: string | null;
  selectedDate: string;
  selectedTodoCount: number;
  onExportAll: () => string;
  onExportSelectedDate: () => string;
  onExportBackup: () => Promise<string>;
  onRestoreBackup: (backup: BackupImport) => Promise<void>;
  onCleanupImages: () => Promise<{
    removedDirs: number;
    removedFiles: number;
    failedDirs: number;
    failedFiles: number;
  }>;
}

type ActionStatus = {
  kind: "info" | "success" | "error";
  message: string;
};

type PendingConfirm =
  | { kind: "import"; backup: BackupImport; recovery: boolean }
  | { kind: "migrate"; directory: string };

function createExportFileName(scopeDate: string | null, now = new Date()): string {
  const exportDate = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("");
  const time = [
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0"),
  ].join("");
  const scope = scopeDate == null ? `all-${exportDate}` : scopeDate;
  return `doTime-todos-${scope}-${time}.txt`;
}

export function DataActions({
  automaticBackup,
  notice,
  selectedDate,
  selectedTodoCount,
  onExportAll,
  onExportSelectedDate,
  onExportBackup,
  onRestoreBackup,
  onCleanupImages,
}: DataActionsProps) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<ActionStatus | null>(
    notice ? { kind: "info", message: notice } : null,
  );
  const [dataDirectory, setDataDirectory] = useState<string | null>(null);
  const [directoryDraft, setDirectoryDraft] = useState("");
  const [directoryBusy, setDirectoryBusy] = useState(false);
  const [backupBusy, setBackupBusy] = useState<"export" | "restore" | null>(null);
  const [recoveryAvailable, setRecoveryAvailable] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  const [toast, setToast] = useState<ActionStatus | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const busy = directoryBusy || backupBusy != null;

  const showStatus = (nextStatus: ActionStatus) => {
    setStatus(nextStatus);
    setToast(nextStatus);
    if (toastTimerRef.current != null) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, 3200);
  };

  useEffect(() => {
    if (notice) showStatus({ kind: "info", message: notice });
  }, [notice]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current != null) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    void getDataDirectory().then((directory) => {
      if (cancelled || directory == null) return;
      setDataDirectory(directory);
      setDirectoryDraft((current) => current || directory);
    });

    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void readRecoveryBackup().then((text) => {
      if (!cancelled) setRecoveryAvailable(text != null && parseAppBackup(text).ok);
    }).catch(() => { if (!cancelled) setRecoveryAvailable(false); });
    return () => { cancelled = true; };
  }, [open, backupBusy]);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && containerRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const downloadText = (
    content: string,
    fileName: string,
    message: string,
    mimeType = "text/plain;charset=utf-8",
  ) => {
    try {
      const blob = new Blob([mimeType.startsWith("text/plain") ? "\uFEFF" : "", content], {
        type: mimeType,
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      showStatus({ kind: "success", message });
    } catch {
      showStatus({ kind: "error", message: "导出失败，请重试。" });
    }
  };

  const handleExportSelectedDate = () => {
    if (selectedTodoCount === 0) {
      showStatus({
        kind: "info",
        message: `${formatDisplayDate(selectedDate)} 没有可导出的待办。`,
      });
      return;
    }

    downloadText(
      onExportSelectedDate(),
      createExportFileName(selectedDate),
      `已导出 ${formatDisplayDate(selectedDate)} 的 ${selectedTodoCount} 个待办。`,
    );
  };

  const handleExportAll = () => {
    downloadText(
      onExportAll(),
      createExportFileName(null),
      "全部待办文档已导出。",
    );
  };

  const handleExportBackup = async () => {
    if (busy) return;
    setBackupBusy("export");
    showStatus({ kind: "info", message: "正在准备备份和图片…" });
    try {
      const text = await onExportBackup();
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      downloadText(text, `doTime-backup-${stamp}.json`, "备份已导出，可用于恢复全部待办、模板和图片。", "application/json;charset=utf-8");
    } catch (error) {
      showStatus({ kind: "error", message: `备份未导出：${error instanceof Error ? error.message : String(error)}` });
    } finally {
      setBackupBusy(null);
    }
  };

  const handleImportFile = async (file: File | undefined) => {
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = parseAppBackup(text);
      if (!parsed.ok) {
        showStatus({ kind: "error", message: parsed.error });
        return;
      }
      setPendingConfirm({ kind: "import", backup: parsed.backup, recovery: false });
    } catch {
      showStatus({ kind: "error", message: "无法读取所选文件。" });
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleCleanupImages = async () => {
    try {
      const result = await onCleanupImages();
      const total = result.removedDirs + result.removedFiles;
      const failed = result.failedDirs + result.failedFiles;
      showStatus({
        kind: failed > 0 ? "info" : "success",
        message:
          failed > 0
            ? `已清理 ${result.removedDirs} 个目录、${result.removedFiles} 个文件，${failed} 项被占用未清理。`
            : total > 0
            ? `已清理 ${result.removedDirs} 个图片目录、${result.removedFiles} 个图片文件。`
            : "没有发现需要清理的图片文件。",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showStatus({
        kind: "error",
        message: message.includes("cleanup_todo_images")
          ? "图片清理命令未加载，请完整重启应用后再试。"
          : `图片清理失败：${message}`,
      });
    }
  };

  const handleOpenDataDirectory = async () => {
    try {
      await openDataDirectory();
      showStatus({ kind: "success", message: "已打开数据目录。" });
    } catch (error) {
      showStatus({
        kind: "error",
        message: `无法打开数据目录：${error instanceof Error ? error.message : String(error)}`,
      });
    }
  };

  const handleMigrateDataDirectory = async () => {
    const nextDirectory = directoryDraft.trim();
    if (!nextDirectory) {
      showStatus({ kind: "info", message: "请先填写新的数据目录。" });
      return;
    }
    if (dataDirectory != null && nextDirectory === dataDirectory) {
      showStatus({ kind: "info", message: "当前已经在使用这个数据目录。" });
      return;
    }

    setPendingConfirm({ kind: "migrate", directory: nextDirectory });
  };

  const prepareRecovery = async () => {
    try {
      const text = await readRecoveryBackup();
      const parsed = text == null ? null : parseAppBackup(text);
      if (parsed == null || !parsed.ok) throw new Error("未找到有效的导入前备份。");
      setPendingConfirm({ kind: "import", backup: parsed.backup, recovery: true });
    } catch (error) {
      showStatus({ kind: "error", message: error instanceof Error ? error.message : String(error) });
    }
  };

  const confirmImportFile = async (backup: BackupImport) => {
    if (busy) return;
    setBackupBusy("restore");
    showStatus({ kind: "info", message: "正在保留原数据并恢复备份…" });
    try {
      await onRestoreBackup(backup);
      setPendingConfirm(null);
      setRecoveryAvailable(true);
      showStatus({ kind: "success", message: `已恢复 ${backup.appData.todos.length} 个待办${backup.templates == null ? "，现有模板已保留" : `、${backup.templates.length} 个模板`}。` });
    } catch (error) {
      setPendingConfirm(null);
      showStatus({ kind: "error", message: error instanceof Error ? error.message : String(error) });
    } finally {
      setBackupBusy(null);
    }
  };

  const confirmMigrateDataDirectory = async (nextDirectory: string) => {
    setDirectoryBusy(true);
    showStatus({ kind: "info", message: "正在迁移数据目录..." });
    try {
      const migratedDirectory = await migrateDataDirectory(nextDirectory);
      setDataDirectory(migratedDirectory);
      setDirectoryDraft(migratedDirectory);
      showStatus({
        kind: "success",
        message: "数据目录已迁移，后续保存会写入新目录。",
      });
    } catch (error) {
      showStatus({
        kind: "error",
        message: `数据目录迁移失败：${error instanceof Error ? error.message : String(error)}`,
      });
    } finally {
      setDirectoryBusy(false);
    }
  };

  const handleConfirm = () => {
    const target = pendingConfirm;
    if (target == null) return;
    if (target.kind === "import") {
      void confirmImportFile(target.backup);
      return;
    }
    setPendingConfirm(null);
    void confirmMigrateDataDirectory(target.directory);
  };

  const confirmDialog =
    pendingConfirm == null ? null : pendingConfirm.kind === "import" ? (
      <ConfirmDialog
        title={pendingConfirm.recovery ? "恢复上次导入前的数据？" : "从备份恢复？"}
        description={<BackupPreview backup={pendingConfirm.backup} busy={backupBusy === "restore"} />}
        icon={<IconUpload size={20} />}
        confirmIcon={<IconUpload size={14} />}
        confirmLabel={backupBusy === "restore" ? "正在恢复…" : "覆盖并恢复"}
        confirmDisabled={backupBusy === "restore"}
        onCancel={() => { if (backupBusy !== "restore") setPendingConfirm(null); }}
        onConfirm={handleConfirm}
      />
    ) : (
      <ConfirmDialog
        title="迁移数据目录？"
        description="迁移会先复制当前数据到新目录，成功后再切换到新目录。旧目录会保留。"
        icon={<IconDeviceFloppy size={20} />}
        confirmIcon={<IconDeviceFloppy size={14} />}
        confirmLabel="迁移"
        confirmDisabled={directoryBusy}
        onCancel={() => setPendingConfirm(null)}
        onConfirm={handleConfirm}
      />
    );

  return (
    <div ref={containerRef} className="data-actions">
      <button
        type="button"
        className="btn btn-ghost btn-icon-only data-actions__toggle"
        onClick={() => setOpen((current) => !current)}
        aria-label="数据管理"
        aria-expanded={open}
        aria-haspopup="dialog"
        title="数据管理"
      >
        <IconDatabaseExport size={17} />
      </button>

      {open && (
        <section
          className="data-actions__popover"
          aria-label="数据备份与恢复"
        >
          <div className="data-actions__header">
            <strong>数据管理</strong>
            <span>当前日期：{formatDisplayDate(selectedDate)}</span>
          </div>
          <div className="data-actions__commands">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => void handleExportBackup()}
              disabled={busy}
            >
              <IconDownload size={15} />
              {backupBusy === "export" ? "准备备份中…" : "导出可恢复备份"}
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm data-actions__import"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy}
            >
              <IconUpload size={15} />
              从备份恢复
            </button>
          </div>
          <p className="data-actions__hint">JSON 备份包含全部待办、回收站、子待办、模板、排序和图片。</p>
          <AutomaticBackupSettings backup={automaticBackup} blocked={busy} />
          {recoveryAvailable && (
            <button type="button" className="data-actions__recovery" disabled={busy} onClick={() => void prepareRecovery()}>
              恢复上次导入前的数据
            </button>
          )}
          <div className="data-actions__section-label">阅读文档（不能用于恢复）</div>
          <div className="data-actions__commands">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={handleExportSelectedDate}
              disabled={busy}
            >
              <IconCalendarEvent size={15} />
              导出当日 TXT
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={handleExportAll}
              disabled={busy}
            >
              <IconDownload size={15} />
              导出全部 TXT
            </button>
          </div>
          <div className="data-actions__maintenance">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => void handleCleanupImages()}
              disabled={busy}
            >
              <IconTrash size={15} />
              清理图片
            </button>
          </div>
          {dataDirectory != null && (
            <div className="data-actions__directory">
              <label>
                <span>数据目录</span>
                <input
                  value={directoryDraft}
                  onChange={(event) => setDirectoryDraft(event.target.value)}
                  spellCheck={false}
                  aria-label="数据目录路径"
                />
              </label>
              <div className="data-actions__directory-actions">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={handleOpenDataDirectory}
                >
                  <IconSettings size={15} />
                  打开目录
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => void handleMigrateDataDirectory()}
                  disabled={busy}
                >
                  <IconDeviceFloppy size={15} />
                  {directoryBusy ? "迁移中" : "迁移目录"}
                </button>
              </div>
              <small>待办、模板、剪贴板记录和图片会保存在这里。</small>
            </div>
          )}
          <input
            ref={fileInputRef}
            className="data-actions__file-input"
            type="file"
            accept="application/json,.json"
            aria-label="选择 doTime 备份文件"
            onChange={(event) =>
              void handleImportFile(event.currentTarget.files?.[0])
            }
          />
          {status && (
            <p
              className={`data-actions__status is-${status.kind}`}
              role={status.kind === "error" ? "alert" : "status"}
              aria-live="polite"
            >
              {status.message}
            </p>
          )}
        </section>
      )}
      {confirmDialog}
      {toast && <ToastNotice kind={toast.kind} message={toast.message} />}
    </div>
  );
}

function BackupPreview({ backup, busy }: { backup: BackupImport; busy: boolean }) {
  const dates = backup.appData.todos.map((todo) => todo.date).sort();
  const trash = backup.appData.trash ?? [];
  const imageCount = [...backup.appData.todos, ...trash.filter(entry => !entry.subtask).map(entry => entry.todo)].reduce((count, todo) => count + (todo.images?.length ?? 0), 0);
  const dateRange = dates.length === 0 ? "无待办" : `${formatDisplayDate(dates[0])} 至 ${formatDisplayDate(dates[dates.length - 1])}`;
  return (
    <span className="backup-preview">
      <span>{backup.appData.todos.length} 个待办 · {trash.length} 条回收站记录 · {imageCount} 张图片{backup.templates == null ? "" : ` · ${backup.templates.length} 个模板`}</span>
      <span>日期范围：{dateRange}</span>
      {backup.exportedAt != null && <span>备份时间：{new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(backup.exportedAt)}</span>}
      <span>{backup.legacy ? "这是旧版备份，将替换待办和回收站并保留现有模板；旧备份中的图片可能依赖原电脑。" : "将替换当前全部待办、回收站和模板，包含图片与排序。"}</span>
      <span>{busy ? "正在恢复，请保持窗口打开。" : "恢复前会自动保留原数据，可从数据管理中恢复。草稿、外观设置和剪贴板记录不参与替换。"}</span>
    </span>
  );
}
