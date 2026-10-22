import { describe, expect, it } from "vitest";
import type { Todo, TodoDraftSnapshot, TodoImage } from "../types";
import { APP_DATA_STORAGE_KEY, createAppDataDocument, loadAppData, saveAppData, type StorageLike } from "./appData";
import { createTaskTemplate, loadTaskTemplates, saveTaskTemplates, TASK_TEMPLATE_STORAGE_KEY } from "./taskTemplates";
import { commitBackupRestore, createAppBackup, parseAppBackup, prepareBackupImages, resumeBackupTiming } from "./appBackup";
import { parseTodoDraftSnapshot } from "./todoDrafts";

class MemoryStorage implements StorageLike {
  readonly values = new Map<string, string>();
  rejectedTitle: string | null = null;
  getItem(key: string) { return this.values.get(key) ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) {
    if (key === APP_DATA_STORAGE_KEY && this.rejectedTitle != null && value.includes(this.rejectedTitle)) {
      throw new Error("storage full");
    }
    this.values.set(key, value);
  }
}

const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=";

function todo(overrides: Partial<Todo> = {}): Todo {
  return {
    id: "todo-1", title: "整理计划", urgency: "high", date: "2026-10-22", sortOrder: 2000,
    plannedSeconds: 1500, countdownEnabled: true, countdownOnlyEnabled: false,
    reminderEnabled: true, reminderTime: "16:30", recordTimeEnabled: true,
    reminderSnoozedUntil: null, reminderLastFiredAt: null, completed: false,
    isTiming: false, timingStartedAt: null, elapsedSeconds: 30, actualDurationSeconds: null,
    createdAt: 1000, completedAt: null, recurrenceSeriesId: "series-1",
    recurrence: { frequency: "weekly", weekdays: [4], monthDay: null, endDate: "2026-12-31" },
    recurrenceTemplate: null, comment: "保留备注", favorite: true, dailyPinned: true,
    dailyPinnedSortOrder: 3000,
    subtasks: [{
      id: "sub-1", title: "检查需求", urgency: "medium", plannedSeconds: 600,
      countdownEnabled: false, recordTimeEnabled: true, completed: false,
      isTiming: false, timingStartedAt: null, elapsedSeconds: 15, actualDurationSeconds: null,
      createdAt: 1000, completedAt: null, children: [{
        id: "child-1", title: "确认日期", urgency: "low", plannedSeconds: 300,
        countdownEnabled: false, recordTimeEnabled: false, completed: true,
        isTiming: false, timingStartedAt: null, elapsedSeconds: 0, actualDurationSeconds: null,
        createdAt: 1000, completedAt: 2000, children: [],
      }],
    }],
    ...overrides,
  };
}

function template() {
  return createTaskTemplate({
    name: "每周复盘", title: "整理本周工作", urgency: "medium", taskTime: "18:00",
    plannedSeconds: 1800, countdownEnabled: true, reminderEnabled: true,
    reminderTime: "17:55", recordTimeEnabled: true,
    recurrence: { frequency: "weekly", weekdays: [5], monthDay: null, endDate: null },
    comment: "记下下一步", subtasks: [{ title: "汇总", urgency: "low", plannedSeconds: 300, countdownEnabled: false, recordTimeEnabled: true }],
  }, 1000, 1000, "template-1");
}

describe("recoverable app backups", () => {
  it("round-trips tasks, nested subtasks, templates, recurrence, categories, ordering and portable image bytes", async () => {
    const original = todo({ images: [{ id: "image-1", name: "参考图.png", mimeType: "image/png", fileName: "local-only.png" }] });
    const data = createAppDataDocument([original], [original.date], [{
      id: "category-1", title: "下午", date: original.date, sortOrder: 1000, createdAt: 1000, updatedAt: 1000,
    }]);

    const backup = await createAppBackup(data, [template()], async (item) =>
      (item.images ?? []).map((image) => ({ ...image, dataUrl: png })));
    const result = parseAppBackup(JSON.stringify(backup));

    expect(JSON.stringify(backup)).not.toContain("local-only.png");
    expect(result.ok).toEqual(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.backup.appData).toMatchObject({
      manualSortDates: [original.date], categoryDividers: data.categoryDividers,
      todos: [{
        title: original.title, sortOrder: original.sortOrder, comment: original.comment,
        favorite: true, dailyPinned: true, dailyPinnedSortOrder: 3000,
        recurrence: original.recurrence, subtasks: original.subtasks,
        images: [{ id: "image-1", name: "参考图.png", dataUrl: png }],
      }],
    });
    expect(result.backup.templates).toEqual([template()]);
  });

  it("refuses incomplete image exports instead of silently exporting missing attachments", async () => {
    const data = createAppDataDocument([todo({ images: [{ id: "image-1", name: "参考图.png", fileName: "missing.png" }] })], []);
    await expect(createAppBackup(data, [], async () => [])).rejects.toThrow("无法完整读取");
  });

  it.each([
    { id: "image-1", name: "图.png", fileName: "machine-only.png" },
    { id: "image-1", name: "图.png", dataUrl: "data:image/png;base64,broken!" },
    { name: "损坏图片" },
  ])("rejects corrupt or non-portable images before any restore (%j)", async (image) => {
    const backup = await createAppBackup(createAppDataDocument([todo()], []), []);
    const raw = { ...backup, appData: { ...backup.appData, todos: [{ ...todo(), images: [image] }] } };
    expect(parseAppBackup(JSON.stringify(raw)).ok).toEqual(false);
  });

  it("accepts legacy task documents without replacing existing templates", () => {
    const result = parseAppBackup(JSON.stringify(createAppDataDocument([todo()], [])));
    expect(result).toMatchObject({ ok: true, backup: { legacy: true, templates: null } });
  });

  it.each(["doTime 待办导出文档", '{"format":"dotime-backup","version":99}', '{"format":"another-app"}'])(
    "rejects text documents and unsupported backup formats (%s)", (text) => {
      expect(parseAppBackup(text).ok).toEqual(false);
    },
  );

  it("rejects dates that cannot be displayed in the restore preview", async () => {
    const backup = await createAppBackup(createAppDataDocument([], []), []);
    expect(parseAppBackup(JSON.stringify({ ...backup, exportedAt: 1e100 })).ok).toEqual(false);
  });

  it("stages new image filenames while preserving existing resources and image IDs", async () => {
    const image: TodoImage = { id: "image-1", name: "图.png", dataUrl: png };
    const calls: { preserve: boolean; images: readonly TodoImage[] }[] = [];
    const prepared = await prepareBackupImages(createAppDataDocument([todo({ images: [image] })], []), async (_id, images = [], preserve = false) => {
      calls.push({ images, preserve });
      return images.map((item) => ({ id: item.id, name: item.name, fileName: `${item.id}.png` }));
    });

    expect(calls[0].preserve).toEqual(true);
    expect(calls[0].images[0].id).not.toEqual(image.id);
    expect(prepared.todos[0].images?.[0]).toMatchObject({ id: "image-1", name: "图.png" });
    expect(prepared.todos[0].images?.[0].fileName).toMatch(/^restore-/);
  });

  it("does not add time spent with a backup on disk to running timers", async () => {
    const startedAt = Date.now() - 60000;
    const backup = await createAppBackup(createAppDataDocument([todo({ isTiming: true, timingStartedAt: startedAt, elapsedSeconds: 30 })], []), []);
    const parsed = parseAppBackup(JSON.stringify(backup));
    if (!parsed.ok) throw new Error(parsed.error);
    const resumedAt = backup.exportedAt + 7 * 86400000;
    const resumed = resumeBackupTiming(parsed.backup, resumedAt).todos[0];

    expect(resumed.elapsedSeconds).toEqual(backup.appData.todos[0].elapsedSeconds);
    expect(resumed.elapsedSeconds).toBeGreaterThanOrEqual(90);
    expect(resumed.elapsedSeconds).toBeLessThan(92);
    expect(resumed.timingStartedAt).toEqual(resumedAt);
  });

  it("commits both task and template data after image preparation", async () => {
    const storage = new MemoryStorage();
    const appData = createAppDataDocument([todo({ title: "恢复后的任务" })], ["2026-10-22"]);
    await commitBackupRestore({ appData, templates: [template()], exportedAt: 1000, legacy: false }, storage, async () => {});

    expect(loadAppData(storage).data.todos[0].title).toEqual("恢复后的任务");
    expect(loadTaskTemplates(storage).templates).toEqual([template()]);
  });

  it("rolls back both documents and their recovery snapshots when storage is full", async () => {
    const storage = new MemoryStorage();
    saveAppData(createAppDataDocument([todo({ title: "原来的任务" })], []), storage);
    saveTaskTemplates([template()], storage);
    const previous = new Map(storage.values);
    storage.rejectedTitle = "incoming";

    await expect(commitBackupRestore({ appData: createAppDataDocument([todo({ title: "incoming" })], []), templates: [], exportedAt: 1000, legacy: false }, storage, async () => {}))
      .rejects.toThrow("已保留原数据");

    expect(storage.values).toEqual(previous);
  });

  it("rolls back task and template writes if mirroring files fails", async () => {
    const storage = new MemoryStorage();
    saveAppData(createAppDataDocument([todo()], []), storage);
    saveTaskTemplates([template()], storage);
    const previous = new Map(storage.values);
    let attempts = 0;

    await expect(commitBackupRestore({ appData: createAppDataDocument([], []), templates: [], exportedAt: 1000, legacy: false }, storage, async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("disk full");
    })).rejects.toThrow("已保留原数据");

    expect(attempts).toEqual(2);
    expect(storage.values).toEqual(previous);
    expect(storage.getItem(TASK_TEMPLATE_STORAGE_KEY)).not.toEqual(null);
  });
});

describe("draft snapshot validation", () => {
  const snapshot: TodoDraftSnapshot = {
    draft: {
      title: "尚未保存", date: "2026-10-22", taskTime: "16:00", comment: "输入中的备注",
      subtaskTitles: "第一步\n第二步", images: [{ id: "image-1", name: "图.png", dataUrl: png }],
      urgency: "high", plannedSeconds: 3600, countdownEnabled: true, countdownOnlyEnabled: true,
      reminderEnabled: true, reminderTime: "17:00", recordTimeEnabled: true,
      recurrence: { frequency: "weekly", weekdays: [4], monthDay: null, endDate: "2026-12-31" },
      recurrenceEditScope: "single",
    },
    countdownTargetTime: "18:30", countdownTimeTouched: true,
  };

  it("retains unfinished text, images, scheduling choices and custom countdown targets", () => {
    expect(parseTodoDraftSnapshot(JSON.parse(JSON.stringify(snapshot)))).toEqual(snapshot);
  });

  it.each([null, {}, { ...snapshot, draft: { ...snapshot.draft, images: [null] } }, { ...snapshot, countdownTimeTouched: "true" }])(
    "ignores invalid stored drafts (%j)", (value) => {
      expect(parseTodoDraftSnapshot(value)).toEqual(null);
    },
  );
});
