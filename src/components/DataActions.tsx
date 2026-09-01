import { useEffect, useRef, useState } from "react";
import type { ImportAppDataResult } from "../data/appData";
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

interface DataActionsProps {
  notice: string | null;
  selectedDate: string;
  selectedTodoCount: number;
  onExportAll: () => string;
  onExportSelectedDate: () => string;
  onImport: (text: string) => ImportAppDataResult;
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
  | { kind: "import"; text: string }
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
  notice,
  selectedDate,
  selectedTodoCount,
  onExportAll,
  onExportSelectedDate,
  onImport,
  onCleanupImages,
}: DataActionsProps) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<ActionStatus | null>(
    notice ? { kind: "info", message: notice } : null,
  );
  const [dataDirectory, setDataDirectory] = useState<string | null>(null);
  const [directoryDraft, setDirectoryDraft] = useState("");
  const [directoryBusy, setDirectoryBusy] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  const [toast, setToast] = useState<ActionStatus | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
  ) => {
    try {
      const blob = new Blob(["\uFEFF", content], {
        type: "text/plain;charset=utf-8",
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

  const handleImportFile = async (file: File | undefined) => {
    if (!file) return;

    try {
      const text = await file.text();
      setPendingConfirm({ kind: "import", text });
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

  const confirmImportFile = (text: string) => {
    const result = onImport(text);
    if (!result.ok) {
      showStatus({ kind: "error", message: result.error });
      return;
    }

    showStatus({
      kind: "success",
      message: `已导入 ${result.data.todos.length} 个待办。`,
    });
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
    setPendingConfirm(null);
    if (target.kind === "import") {
      confirmImportFile(target.text);
      return;
    }
    void confirmMigrateDataDirectory(target.directory);
  };

  const confirmDialog =
    pendingConfirm == null ? null : pendingConfirm.kind === "import" ? (
      <ConfirmDialog
        title="导入旧备份？"
        description="导入会替换当前待办数据，现有数据会自动保留在本地备份中。"
        icon={<IconUpload size={20} />}
        confirmIcon={<IconUpload size={14} />}
        confirmLabel="导入"
        onCancel={() => setPendingConfirm(null)}
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
              className="btn btn-secondary btn-sm"
              onClick={handleExportSelectedDate}
            >
              <IconCalendarEvent size={15} />
              导出当日
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={handleExportAll}
            >
              <IconDownload size={15} />
              导出全部
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm data-actions__import"
              onClick={() => fileInputRef.current?.click()}
            >
              <IconUpload size={15} />
              导入旧备份
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => void handleCleanupImages()}
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
                  disabled={directoryBusy}
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
