import type { TaskTemplate, Todo, TodoImage, TodoSubtask } from "../types";
import {
  APP_DATA_STORAGE_KEY,
  LEGACY_MANUAL_SORT_DATES_STORAGE_KEY,
  LEGACY_TODO_STORAGE_KEY,
  parseImportedAppData,
  saveAppData,
  type AppDataDocument,
  type StorageLike,
} from "./appData";
import {
  TASK_TEMPLATE_BACKUP_KEY,
  TASK_TEMPLATE_STORAGE_KEY,
  parseTaskTemplates,
  saveTaskTemplates,
} from "./taskTemplates";
import { copyTodoImages, persistTodoImages } from "../utils/todoImages";

export interface AppBackup {
  format: "dotime-backup";
  version: 1;
  exportedAt: number;
  appData: AppDataDocument;
  templates: TaskTemplate[];
}

export interface BackupImport {
  appData: AppDataDocument;
  templates: TaskTemplate[] | null;
  exportedAt: number | null;
  legacy: boolean;
}

export type ParseBackupResult =
  | { ok: true; backup: BackupImport }
  | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function isPortableImage(image: TodoImage): boolean {
  if (typeof image.dataUrl !== "string") return false;
  const match = /^data:image\/[a-zA-Z0-9.+-]+;base64,([A-Za-z0-9+/]+={0,2})$/.exec(image.dataUrl);
  return match != null && match[1].length % 4 === 0;
}

export function parseAppBackup(text: string): ParseBackupResult {
  let value: unknown;
  try {
    value = JSON.parse(text.replace(/^\uFEFF/, "")) as unknown;
  } catch {
    return { ok: false, error: "请选择 doTime 导出的 JSON 备份；TXT 阅读文档不能用于恢复。" };
  }
  if (isRecord(value) && value.format === "dotime-backup") {
    if (value.version !== 1) return { ok: false, error: "暂不支持这个版本的备份，请更新 doTime 后重试。" };
    const parsed = parseImportedAppData(JSON.stringify(value.appData));
    const templates = parseTaskTemplates(value.templates);
    if (!parsed.ok || templates == null ||
        typeof value.exportedAt !== "number" || !Number.isFinite(new Date(value.exportedAt).getTime())) {
      return { ok: false, error: "备份数据不完整或已损坏，当前数据未更改。" };
    }
    if (new Set(parsed.data.todos.map((todo) => todo.id)).size !== parsed.data.todos.length ||
        new Set(templates.map((template) => template.id)).size !== templates.length) {
      return { ok: false, error: "备份包含重复的任务或模板标识，无法恢复。" };
    }
    const rawTodos = isRecord(value.appData) && Array.isArray(value.appData.todos) ? value.appData.todos : [];
    if (parsed.data.todos.some((todo, index) => {
      const raw = rawTodos[index];
      const rawImages = isRecord(raw) ? raw.images : undefined;
      return (rawImages !== undefined && (!Array.isArray(rawImages) || rawImages.length !== (todo.images ?? []).length)) ||
        (todo.images ?? []).some((image) => !isPortableImage(image));
    })) {
      return { ok: false, error: "备份缺少图片内容，无法完整恢复。请在原电脑重新导出备份。" };
    }
    return { ok: true, backup: { appData: parsed.data, templates, exportedAt: value.exportedAt, legacy: false } };
  }
  if (isRecord(value) && "format" in value) {
    return { ok: false, error: "这不是 doTime 备份文件。" };
  }
  const legacy = parseImportedAppData(JSON.stringify(value));
  return legacy.ok
    ? { ok: true, backup: { appData: legacy.data, templates: null, exportedAt: null, legacy: true } }
    : { ok: false, error: legacy.error };
}

export async function createAppBackup(
  data: AppDataDocument,
  templates: readonly TaskTemplate[],
  readImages: (todo: Todo) => Promise<TodoImage[]> = copyTodoImages,
): Promise<AppBackup> {
  const exportedAt = Date.now();
  const todos: Todo[] = [];
  // Keep peak memory bounded when many tasks contain images.
  for (const todo of data.todos) {
    const images = await readImages(todo);
    if (images.length !== (todo.images ?? []).length || images.some((image) => !isPortableImage(image))) {
      throw new Error(`无法完整读取「${todo.title}」的图片，备份未导出。`);
    }
    todos.push({
      ...checkpointTiming(todo, exportedAt, exportedAt),
      subtasks: todo.subtasks?.map((subtask) => checkpointSubtask(subtask, exportedAt, exportedAt)),
      images: images.map(({ id, name, mimeType, dataUrl }) => ({ id, name, mimeType, dataUrl })),
    });
  }
  return {
    format: "dotime-backup",
    version: 1,
    exportedAt,
    appData: { ...data, todos },
    templates: [...templates],
  };
}

function checkpointTiming<T extends Pick<Todo, "isTiming" | "timingStartedAt" | "elapsedSeconds">>(
  item: T,
  checkpoint: number,
  resumedAt: number,
): T {
  if (!item.isTiming || item.timingStartedAt == null) return item;
  return {
    ...item,
    elapsedSeconds: item.elapsedSeconds + Math.max(0, Math.floor((checkpoint - item.timingStartedAt) / 1000)),
    timingStartedAt: resumedAt,
  };
}

function checkpointSubtask(subtask: TodoSubtask, checkpoint: number, resumedAt: number): TodoSubtask {
  return {
    ...checkpointTiming(subtask, checkpoint, resumedAt),
    children: subtask.children.map((child) => checkpointSubtask(child, checkpoint, resumedAt)),
  };
}

/** Time spent with the backup on disk must not count as task execution. */
export function resumeBackupTiming(backup: BackupImport, now = Date.now()): AppDataDocument {
  const checkpoint = backup.exportedAt ?? now;
  return {
    ...backup.appData,
    todos: backup.appData.todos.map((todo) => ({
      ...checkpointTiming(todo, checkpoint, now),
      subtasks: todo.subtasks?.map((subtask) => checkpointSubtask(subtask, checkpoint, now)),
    })),
  };
}

export async function prepareBackupImages(
  data: AppDataDocument,
  writeImages: typeof persistTodoImages = persistTodoImages,
): Promise<AppDataDocument> {
  const todos: Todo[] = [];
  for (const todo of data.todos) {
    const images = todo.images ?? [];
    if (images.length === 0) {
      todos.push(todo);
      continue;
    }
    // New image IDs produce new filenames, so failure cannot overwrite the old files.
    const staged = images.map((image) => image.dataUrl
      ? { ...image, id: `restore-${crypto.randomUUID()}`, fileName: undefined }
      : image);
    const stored = await writeImages(todo.id, staged, true);
    if (stored.length !== images.length) throw new Error(`无法完整恢复「${todo.title}」的图片。`);
    todos.push({ ...todo, images: stored.map((image, index) => ({ ...image, id: images[index].id })) });
  }
  return { ...data, todos };
}

const RESTORE_STORAGE_KEYS = [
  APP_DATA_STORAGE_KEY,
  `${APP_DATA_STORAGE_KEY}-backup-1`,
  `${APP_DATA_STORAGE_KEY}-backup-2`,
  `${APP_DATA_STORAGE_KEY}-backup-3`,
  LEGACY_TODO_STORAGE_KEY,
  LEGACY_MANUAL_SORT_DATES_STORAGE_KEY,
  TASK_TEMPLATE_STORAGE_KEY,
  TASK_TEMPLATE_BACKUP_KEY,
];

/** Commit both documents together, with an explicit rollback for storage or file errors. */
export async function commitBackupRestore(
  backup: BackupImport,
  storage: StorageLike,
  mirrorFiles: () => Promise<void>,
): Promise<void> {
  const previous = new Map(RESTORE_STORAGE_KEYS.map((key) => [key, storage.getItem(key)]));
  try {
    if (backup.templates != null) {
      const result = saveTaskTemplates(backup.templates, storage);
      if (!result.ok) throw new Error(result.error);
    }
    const result = saveAppData(backup.appData, storage);
    if (!result.ok) throw new Error(result.error);
    await mirrorFiles();
  } catch (error) {
    try {
      for (const key of RESTORE_STORAGE_KEYS) storage.removeItem(key);
      for (const [key, value] of previous) {
        if (value != null) storage.setItem(key, value);
      }
      await mirrorFiles();
    } catch {
      throw new Error("恢复未完成，自动回退失败。请使用“恢复上次导入前的数据”重试，或重新导入此前的备份。");
    }
    throw new Error(`恢复失败，已保留原数据：${error instanceof Error ? error.message : String(error)}`);
  }
}
