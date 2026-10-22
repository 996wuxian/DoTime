import { describe, expect, it, vi } from "vitest";
import type { Todo, TodoSubtask } from "../types";
import { archiveTodos, archiveSubtask, expireTrash, purgeTrash, getRetainedImageTodos, getTrashRestoreBlocker, restoreTrash, TRASH_RETENTION_MS } from "./recycleBin";
import { APP_DATA_STORAGE_KEY, createAppDataDocument, loadAppData, parseImportedAppData, saveAppData } from "../data/appData";
import { createAppBackup, parseAppBackup, prepareBackupImages } from "../data/appBackup";

const now = new Date("2026-10-22T12:00:00Z").getTime();
const todo = (overrides: Partial<Todo> = {}): Todo => ({
  id: "task", title: "交电费", date: "2026-10-21", urgency: "medium", sortOrder: 2000,
  plannedSeconds: 1500, countdownEnabled: true, recordTimeEnabled: true,
  reminderEnabled: true, reminderTime: "10:00", reminderSnoozedUntil: null, reminderLastFiredAt: null,
  completed: false, isTiming: false, timingStartedAt: null, elapsedSeconds: 30, actualDurationSeconds: null,
  createdAt: now - 100000, completedAt: null, recurrenceSeriesId: null, recurrence: null, recurrenceTemplate: null,
  comment: "付款后保存收据", images: [{ id: "pic", name: "账单", fileName: "bill.png" }], subtasks: [], ...overrides,
});
const subtask = (id: string, children: TodoSubtask[] = []): TodoSubtask => ({
  id, title: id, urgency: "high", plannedSeconds: 60, countdownEnabled: true, recordTimeEnabled: true,
  isTiming: false, timingStartedAt: null, elapsedSeconds: 2, actualDurationSeconds: null,
  completed: false, completedAt: null, createdAt: now - 100000, children,
});
const memoryStorage = () => {
  const map = new Map<string, string>();
  return { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value); }, removeItem: (key: string) => { map.delete(key); } };
};

describe("删除撤销与回收站", () => {
  it("删除时结算主任务和下级计时，保留图片、备注、日期及排序", () => {
    const child = { ...subtask("child"), isTiming: true, timingStartedAt: now - 5000 };
    const original = todo({ isTiming: true, timingStartedAt: now - 10000, subtasks: [child] });
    const state = archiveTodos({ todos: [original], trash: [] }, [original.id], now, "batch");
    expect(state.todos).toEqual([]);
    expect(state.trash[0].todo).toMatchObject({ elapsedSeconds: 40, isTiming: false, timingStartedAt: null,
      date: original.date, sortOrder: original.sortOrder, comment: original.comment, images: original.images });
    expect(state.trash[0].todo.subtasks?.[0]).toMatchObject({ elapsedSeconds: 7, isTiming: false, timingStartedAt: null });
    expect(original.isTiming).toBe(true);
  });

  it("批量撤销只恢复该次删除，不覆盖后来新增或编辑的内容，不重启倒计时", () => {
    const first = todo({ countdownOnlyEnabled: true });
    const second = todo({ id: "second" });
    const deleted = archiveTodos({ todos: [first, second], trash: [] }, [first.id, second.id], now, "batch");
    const newer = todo({ id: "newer", title: "后来新增" });
    const restored = restoreTrash({ ...deleted, todos: [newer] }, deleted.trash.map(entry => entry.id), now + 10000);
    expect(restored.todos).toHaveLength(3);
    expect(restored.todos[0]).toBe(newer);
    expect(restored.todos[1]).toMatchObject({ date: first.date, countdownOnlyEnabled: false, isTiming: false, reminderLastFiredAt: now + 10000 });
    expect(restored.trash).toEqual([]);
    expect(restoreTrash(restored, deleted.trash.map(entry => entry.id), now + 20000)).toBe(restored);
  });

  it("子待办按原位置恢复，保留父待办删除后的修改", () => {
    const original = todo({ subtasks: [subtask("a"), subtask("b", [subtask("nested")]), subtask("c")] });
    const state = archiveSubtask({ todos: [original], trash: [] }, original.id, "b", now, "child-batch");
    expect(state.todos[0].subtasks?.map(item => item.id)).toEqual(["a", "c"]);
    const restored = restoreTrash({ ...state, todos: [{ ...state.todos[0], title: "父待办新标题", comment: "新备注" }] }, [state.trash[0].id], now + 1000);
    expect(restored.todos[0]).toMatchObject({ title: "父待办新标题", comment: "新备注" });
    expect(restored.todos[0].subtasks?.map(item => item.id)).toEqual(["a", "b", "c"]);
    expect(restored.todos[0].subtasks?.[1].children[0].id).toBe("nested");
  });

  it("先后删除下级、上级和主待办时，全部恢复按依赖顺序处理", () => {
    const original = todo({ subtasks: [subtask("parent", [subtask("nested")])] });
    let state = archiveSubtask({ todos: [original], trash: [] }, original.id, "nested", now, "nested-batch");
    state = archiveSubtask(state, original.id, "parent", now + 100, "parent-batch");
    state = archiveTodos(state, [original.id], now + 200, "task-batch");
    const nested = state.trash.find(entry => entry.batchId === "nested-batch")!;
    expect(getTrashRestoreBlocker(nested, state.todos)).toBe("请先恢复所属待办");
    const restored = restoreTrash({ ...state, trash: [...state.trash].reverse() }, state.trash.map(entry => entry.id), now + 1000);
    expect(restored.trash).toEqual([]);
    expect(restored.todos[0].subtasks?.[0].children[0].id).toBe("nested");
  });

  it("连续删除相邻子待办后逐个恢复，仍保留原先的相对顺序", () => {
    const original = todo({ subtasks: [subtask("a"), subtask("b"), subtask("c")] });
    let state = archiveSubtask({ todos: [original], trash: [] }, original.id, "a", now, "a");
    state = archiveSubtask(state, original.id, "b", now + 100, "b");
    state = restoreTrash(state, [state.trash.find(entry => entry.batchId === "a")!.id], now + 200);
    state = restoreTrash(state, state.trash.map(entry => entry.id), now + 300);
    expect(state.todos[0].subtasks?.map(item => item.id)).toEqual(["a", "b", "c"]);
  });

  it("相同标识已存在时不覆盖；缺少上级时保留回收站记录", () => {
    const original = todo({ subtasks: [subtask("parent", [subtask("nested")])] });
    const deleted = archiveTodos({ todos: [original], trash: [] }, [original.id], now, "batch");
    const current = todo({ title: "不应覆盖" });
    const state = { ...deleted, todos: [current] };
    expect(restoreTrash(state, [deleted.trash[0].id], now + 1)).toBe(state);
    const childState = archiveSubtask({ todos: [original], trash: [] }, original.id, "nested", now, "nested");
    expect(getTrashRestoreBlocker(childState.trash[0], [todo()])).toBe("请先恢复上级子待办");
  });

  it("满 30 天才过期，过期记录不可恢复，清理图片引用前保留仍在回收站的所有者", () => {
    const state = archiveTodos({ todos: [todo()], trash: [] }, ["task"], now, "batch");
    expect(expireTrash(state, now + TRASH_RETENTION_MS - 1)).toBe(state);
    expect(getRetainedImageTodos([], state.trash)[0].images?.[0].fileName).toBe("bill.png");
    expect(restoreTrash(state, [state.trash[0].id], now + TRASH_RETENTION_MS)).toBe(state);
    expect(expireTrash(state, now + TRASH_RETENTION_MS).trash).toEqual([]);
    expect(getRetainedImageTodos([], [])).toEqual([]);
  });

  it("永久删除仅清除选中的回收站记录，活动任务和其他删除批次不受影响", () => {
    let state = archiveTodos({ todos: [todo(), todo({ id: "second" }), todo({ id: "active" })], trash: [] }, ["task"], now, "first");
    state = archiveTodos(state, ["second"], now + 1, "second");
    const entry = state.trash.find(item => item.todo.id === "task")!;
    const purged = purgeTrash(state, [entry.id]);
    expect(purged.todos).toBe(state.todos);
    expect(purged.trash.map(item => item.todo.id)).toEqual(["second"]);
    expect(getRetainedImageTodos(purged.todos, purged.trash).map(item => item.id)).toEqual(["active", "second"]);
    expect(restoreTrash(purged, [entry.id], now + 100)).toBe(purged);
    expect(purgeTrash(purged, purged.trash.map(item => item.id)).trash).toEqual([]);
  });

  it("保存回收站失败时保留磁盘上原任务，避免只保存删除而丢失恢复记录", () => {
    const storage = memoryStorage();
    saveAppData(createAppDataDocument([todo()], []), storage);
    const state = archiveTodos({ todos: [todo()], trash: [] }, ["task"], now, "batch");
    const failedStorage = { ...storage, setItem: (key: string, value: string) => {
      if (key === APP_DATA_STORAGE_KEY) throw new Error("磁盘空间不足");
      storage.setItem(key, value);
    } };
    expect(saveAppData(createAppDataDocument([], [], [], state.trash), failedStorage)).toMatchObject({ ok: false });
    expect(loadAppData(storage).data.todos[0].id).toBe("task");
  });

  it("回收站与活动任务同文档持久化，旧版文档仍可读，分类和待写入图片不丢失", () => {
    const storage = memoryStorage();
    const original = todo({ images: [{ id: "inline", name: "未写入图片", dataUrl: "data:image/png;base64,YQ==" }] });
    const state = archiveTodos({ todos: [original], trash: [] }, [original.id], now, "batch", {
      manualSort: true, categoryDividers: [{ id: "divider", title: "生活", date: original.date, sortOrder: 1000, createdAt: now, updatedAt: now }],
    });
    expect(saveAppData(createAppDataDocument([], [], [], state.trash), storage)).toEqual({ ok: true });
    const loaded = loadAppData(storage).data;
    expect(loaded.trash?.[0]).toMatchObject({ manualSort: true, todo: { images: original.images }, categoryDividers: [{ title: "生活" }] });
    const legacy = { version: 2, updatedAt: now, todos: [todo()], categoryDividers: [], manualSortDates: [] };
    expect(parseImportedAppData(JSON.stringify(legacy))).toMatchObject({ ok: true, data: { trash: [] } });
    storage.setItem(APP_DATA_STORAGE_KEY, JSON.stringify({ ...legacy, trash: [{ id: "broken" }] }));
    expect(parseImportedAppData(storage.getItem(APP_DATA_STORAGE_KEY)!)).toMatchObject({ ok: false });
  });

  it("JSON 备份包含已删除任务的图片，恢复到其他电脑时重新写入图片", async () => {
    const state = archiveTodos({ todos: [todo()], trash: [] }, ["task"], now, "batch");
    const data = createAppDataDocument([], [], [], state.trash);
    const read = vi.fn(async () => [{ id: "pic", name: "账单", dataUrl: "data:image/png;base64,YQ==" }]);
    const backup = await createAppBackup(data, [], read);
    const parsed = parseAppBackup(JSON.stringify(backup));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const write = vi.fn(async (_id: string, images: readonly import("../types").TodoImage[] = []) => images.map(image => ({ id: image.id, name: image.name, fileName: "restored.png" })));
    const restored = await prepareBackupImages(parsed.backup.appData, write);
    expect(write).toHaveBeenCalledWith("task", expect.any(Array), true);
    expect(restored.trash?.[0].todo.images?.[0].fileName).toBe("restored.png");
    const broken = structuredClone(backup);
    broken.appData.trash![0].todo.images![0] = { id: "pic", name: "账单", fileName: "local-only.png" };
    expect(parseAppBackup(JSON.stringify(broken))).toMatchObject({ ok: false });
  });
});
