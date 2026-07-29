import { describe, expect, it } from "vitest";
import type { Todo } from "../types";
import {
  APP_DATA_STORAGE_KEY,
  APP_DATA_VERSION,
  LEGACY_TODO_STORAGE_KEY,
  createAppDataDocument,
  exportAppDataAsText,
  loadAppData,
  parseImportedAppData,
  saveAppData,
  type StorageLike,
} from "./appData";

class MemoryStorage implements StorageLike {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

function createTodo(overrides: Partial<Todo> = {}): Todo {
  return {
    id: "todo-1",
    title: "备份测试",
    urgency: "medium",
    date: "2026-07-29",
    sortOrder: 1000,
    plannedSeconds: 0,
    countdownEnabled: false,
    reminderEnabled: false,
    reminderTime: null,
    recordTimeEnabled: true,
    reminderSnoozedUntil: null,
    reminderLastFiredAt: null,
    completed: false,
    isTiming: false,
    timingStartedAt: null,
    elapsedSeconds: 0,
    actualDurationSeconds: null,
    createdAt: 1,
    completedAt: null,
    ...overrides,
  };
}

describe("app data storage", () => {
  it("migrates the legacy todo array into the v2 document", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      LEGACY_TODO_STORAGE_KEY,
      JSON.stringify([
        {
          ...createTodo(),
          sortOrder: undefined,
          recordTimeEnabled: undefined,
        },
      ]),
    );

    const result = loadAppData(storage);

    expect(result.source).toEqual("legacy");
    expect(result.data.version).toEqual(APP_DATA_VERSION);
    expect(result.data.todos[0].sortOrder).toEqual(1000);
    expect(result.data.todos[0].recordTimeEnabled).toEqual(true);
  });

  it("recovers from the newest valid backup when primary data is corrupt", () => {
    const storage = new MemoryStorage();
    const backup = createAppDataDocument([createTodo()], []);
    storage.setItem(APP_DATA_STORAGE_KEY, "{broken");
    storage.setItem(
      `${APP_DATA_STORAGE_KEY}-backup-1`,
      JSON.stringify(backup),
    );

    const result = loadAppData(storage);

    expect(result.source).toEqual("backup");
    expect(result.data.todos).toHaveLength(1);
    expect(result.notice).toContain("备份恢复");
  });

  it("rotates a valid primary document into the first backup", () => {
    const storage = new MemoryStorage();
    const first = createAppDataDocument([createTodo({ title: "旧数据" })], []);
    const second = createAppDataDocument([createTodo({ title: "新数据" })], []);
    storage.setItem(APP_DATA_STORAGE_KEY, JSON.stringify(first));

    const result = saveAppData(second, storage);

    expect(result.ok).toEqual(true);
    const backup = JSON.parse(
      storage.getItem(`${APP_DATA_STORAGE_KEY}-backup-1`) ?? "null",
    ) as { todos: Todo[] };
    expect(backup.todos[0].title).toEqual("旧数据");
  });

  it("rejects unsupported future data versions", () => {
    const result = parseImportedAppData(
      JSON.stringify({ version: 99, todos: [], manualSortDates: [] }),
    );

    expect(result).toStrictEqual({
      ok: false,
      error: "暂不支持 v99 数据文件。",
    });
  });

  it("exports readable text with spacing between todos", () => {
    const first = createTodo({ id: "todo-1", title: "第一项" });
    const second = createTodo({
      id: "todo-2",
      title: "第二项",
      sortOrder: 2000,
    });

    const text = exportAppDataAsText(
      createAppDataDocument([first, second], []),
    );

    expect(text).toContain("doTime 待办文档\r\n");
    expect(text).toContain("日期：2026/7/29（2 个待办）");
    expect(text).toContain("标题：第一项");
    expect(text).toContain("标题：第二项");
    expect(text).toContain(
      `累计耗时：0秒\r\n\r\n${"-".repeat(60)}\r\n\r\n待办 2`,
    );
  });

  it("exports only todos from the selected date", () => {
    const selected = createTodo({ id: "todo-1", title: "当日待办" });
    const anotherDate = createTodo({
      id: "todo-2",
      title: "其他日期待办",
      date: "2026-07-30",
    });

    const text = exportAppDataAsText(
      createAppDataDocument([selected, anotherDate], []),
      "2026-07-29",
    );

    expect(text).toContain("导出范围：2026/7/29");
    expect(text).toContain("标题：当日待办");
    expect(text).not.toContain("其他日期待办");
  });
});
