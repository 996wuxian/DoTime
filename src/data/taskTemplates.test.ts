import { describe, expect, it } from "vitest";
import type { TaskTemplate } from "../types";
import type { StorageLike } from "./appData";
import {
  TASK_TEMPLATE_BACKUP_KEY,
  TASK_TEMPLATE_STORAGE_KEY,
  createTaskTemplate,
  loadTaskTemplates,
  saveTaskTemplates,
  type TaskTemplateInput,
} from "./taskTemplates";

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

function input(overrides: Partial<TaskTemplateInput> = {}): TaskTemplateInput {
  return {
    name: "晨会",
    title: "参加每日晨会",
    urgency: "medium",
    plannedSeconds: 1800,
    countdownEnabled: true,
    reminderEnabled: true,
    reminderTime: "09:25",
    recordTimeEnabled: true,
    recurrence: null,
    ...overrides,
  };
}

function template(overrides: Partial<TaskTemplate> = {}): TaskTemplate {
  return {
    ...createTaskTemplate(input(), 1000, 100, "template-1"),
    ...overrides,
  };
}

describe("task template storage", () => {
  it("creates a normalized template without a fixed recurrence end date", () => {
    const result = createTaskTemplate(
      input({
        recurrence: {
          frequency: "weekly",
          weekdays: [5, 1],
          monthDay: null,
          endDate: "2026-12-31",
        },
      }),
      1000,
      100,
      "template-1",
    );

    expect(result.id).toEqual("template-1");
    expect(result.recurrence).toStrictEqual({
      frequency: "weekly",
      weekdays: [1, 5],
      monthDay: null,
      endDate: null,
    });
  });

  it("saves and loads templates in manual order", () => {
    const storage = new MemoryStorage();
    const result = saveTaskTemplates(
      [template({ id: "second", sortOrder: 2000 }), template({ id: "first" })],
      storage,
    );

    expect(result.ok).toEqual(true);
    expect(loadTaskTemplates(storage).templates.map((item) => item.id)).toEqual([
      "first",
      "second",
    ]);
  });

  it("recovers templates from the backup document", () => {
    const storage = new MemoryStorage();
    saveTaskTemplates([template()], storage);
    const valid = storage.getItem(TASK_TEMPLATE_STORAGE_KEY);
    storage.setItem(TASK_TEMPLATE_BACKUP_KEY, valid ?? "");
    storage.setItem(TASK_TEMPLATE_STORAGE_KEY, "{broken");

    const result = loadTaskTemplates(storage);

    expect(result.source).toEqual("backup");
    expect(result.templates).toHaveLength(1);
    expect(result.notice).toContain("备份恢复");
  });

  it("rejects a document containing an invalid template", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      TASK_TEMPLATE_STORAGE_KEY,
      JSON.stringify({ version: 1, updatedAt: 1, templates: [{ id: "bad" }] }),
    );

    expect(loadTaskTemplates(storage)).toStrictEqual({
      templates: [],
      source: "empty",
      notice: null,
    });
  });
});
