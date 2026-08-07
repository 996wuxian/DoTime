import { useEffect, useRef, useState } from "react";
import type { ImportAppDataResult } from "../data/appData";
import { formatDisplayDate } from "../utils/time";
import {
  IconCalendarEvent,
  IconDatabaseExport,
  IconDownload,
  IconTrash,
  IconUpload,
} from "./icons";

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
  const containerRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (notice) setStatus({ kind: "info", message: notice });
  }, [notice]);

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
      setStatus({ kind: "success", message });
    } catch {
      setStatus({ kind: "error", message: "导出失败，请重试。" });
    }
  };

  const handleExportSelectedDate = () => {
    if (selectedTodoCount === 0) {
      setStatus({
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
      const confirmed = window.confirm(
        "导入会替换当前待办数据，现有数据会自动保留在本地备份中。是否继续？",
      );
      if (!confirmed) return;

      const result = onImport(text);
      if (!result.ok) {
        setStatus({ kind: "error", message: result.error });
        return;
      }

      setStatus({
        kind: "success",
        message: `已导入 ${result.data.todos.length} 个待办。`,
      });
    } catch {
      setStatus({ kind: "error", message: "无法读取所选文件。" });
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleCleanupImages = async () => {
    try {
      const result = await onCleanupImages();
      const total = result.removedDirs + result.removedFiles;
      const failed = result.failedDirs + result.failedFiles;
      setStatus({
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
      setStatus({
        kind: "error",
        message: message.includes("cleanup_todo_images")
          ? "图片清理命令未加载，请完整重启应用后再试。"
          : `图片清理失败：${message}`,
      });
    }
  };

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
    </div>
  );
}
