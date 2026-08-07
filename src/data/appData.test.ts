import { describe, expect, it } from "vitest";
import type { Todo, TodoCategoryDivider } from "../types";
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

class FailingAuxiliaryStorage extends MemoryStorage {
  setItem(key: string, value: string): void {
    if (key.includes("backup") || key === LEGACY_TODO_STORAGE_KEY) {
      throw new Error("quota exceeded");
    }
    super.setItem(key, value);
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
    recurrenceSeriesId: null,
    recurrence: null,
    recurrenceTemplate: null,
    ...overrides,
  };
}

function createCategoryDivider(
  overrides: Partial<TodoCategoryDivider> = {},
): TodoCategoryDivider {
  return {
    id: "category-1",
    title: "上午",
    date: "2026-07-29",
    sortOrder: 1500,
    createdAt: 1,
    updatedAt: 1,
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

  it("does not persist inline image data into localStorage", () => {
    const storage = new MemoryStorage();
    const todo = createTodo({
      images: [
        {
          id: "image-inline",
          name: "临时图片",
          mimeType: "image/png",
          dataUrl: "data:image/png;base64,aaaa",
        },
        {
          id: "image-file",
          name: "已保存图片",
          mimeType: "image/png",
          fileName: "image-file.png",
        },
      ],
    });

    const result = saveAppData(createAppDataDocument([todo], []), storage);
    const saved = JSON.parse(
      storage.getItem(APP_DATA_STORAGE_KEY) ?? "null",
    ) as { todos: Todo[] };

    expect(result.ok).toEqual(true);
    expect(JSON.stringify(saved)).not.toContain("data:image");
    expect(saved.todos[0].images).toStrictEqual([
      {
        id: "image-file",
        name: "已保存图片",
        mimeType: "image/png",
        fileName: "image-file.png",
      },
    ]);
  });

  it("persists todo category dividers", () => {
    const storage = new MemoryStorage();
    const divider = createCategoryDivider();

    const result = saveAppData(
      createAppDataDocument([createTodo()], [], [divider]),
      storage,
    );
    const loaded = loadAppData(storage);

    expect(result.ok).toEqual(true);
    expect(loaded.data.categoryDividers).toStrictEqual([divider]);
  });

  it("keeps saving primary data when backups or legacy mirrors fail", () => {
    const storage = new FailingAuxiliaryStorage();
    storage.setItem(
      APP_DATA_STORAGE_KEY,
      JSON.stringify(createAppDataDocument([createTodo({ title: "旧数据" })], [])),
    );
    const next = createAppDataDocument([createTodo({ title: "新数据" })], []);

    const result = saveAppData(next, storage);
    const saved = JSON.parse(
      storage.getItem(APP_DATA_STORAGE_KEY) ?? "null",
    ) as { todos: Todo[] };

    expect(result.ok).toEqual(true);
    expect(saved.todos[0].title).toEqual("新数据");
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

  it("loads todo image metadata stored on disk", () => {
    const todo = createTodo({
      images: [
        {
          id: "image-1",
          name: "proof.png",
          mimeType: "image/png",
          fileName: "image-1.png",
        },
      ],
    });
    const storage = new MemoryStorage();
    storage.setItem(
      APP_DATA_STORAGE_KEY,
      JSON.stringify(createAppDataDocument([todo], [])),
    );

    const result = loadAppData(storage);

    expect(result.data.todos[0].images).toStrictEqual(todo.images);
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
