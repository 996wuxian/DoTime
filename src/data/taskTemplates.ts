import type {
  RecurrenceFrequency,
  RecurrenceRule,
  TaskTemplate,
  Urgency,
} from "../types";
import { normalizeReminderTime } from "../utils/reminders";
import type { StorageLike } from "./appData";

export const TASK_TEMPLATE_STORAGE_KEY = "dotime-task-templates-v1";
export const TASK_TEMPLATE_BACKUP_KEY = `${TASK_TEMPLATE_STORAGE_KEY}-backup`;
export const TASK_TEMPLATE_DATA_VERSION = 1 as const;

export interface TaskTemplateInput {
  name: string;
  title: string;
  urgency: Urgency;
  plannedSeconds: number;
  countdownEnabled: boolean;
  reminderEnabled: boolean;
  reminderTime: string | null;
  recordTimeEnabled: boolean;
  recurrence: RecurrenceRule | null;
}

interface TaskTemplateDocument {
  version: typeof TASK_TEMPLATE_DATA_VERSION;
  updatedAt: number;
  templates: TaskTemplate[];
}

export type LoadTaskTemplatesResult = {
  templates: TaskTemplate[];
  source: "primary" | "backup" | "empty";
  notice: string | null;
};

export type SaveTaskTemplatesResult =
  | { ok: true }
  | { ok: false; error: string };

type UnknownRecord = Record<string, unknown>;

const URGENCIES = new Set<Urgency>(["low", "medium", "high", "critical"]);
const FREQUENCIES = new Set<RecurrenceFrequency>([
  "daily",
  "weekdays",
  "weekly",
  "monthly",
]);

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value != null && !Array.isArray(value);
}

function parseJson(raw: string | null): unknown {
  if (raw == null) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function parseRecurrence(value: unknown): RecurrenceRule | null {
  if (!isRecord(value) || typeof value.frequency !== "string") return null;
  if (!FREQUENCIES.has(value.frequency as RecurrenceFrequency)) return null;
  const frequency = value.frequency as RecurrenceFrequency;
  const weekdays = Array.isArray(value.weekdays)
    ? [...new Set(value.weekdays.filter(
        (day): day is number => Number.isInteger(day) && day >= 1 && day <= 7,
      ))].sort((a, b) => a - b)
    : [];
  const monthDay =
    typeof value.monthDay === "number" &&
    Number.isInteger(value.monthDay) &&
    value.monthDay >= 1 &&
    value.monthDay <= 31
      ? value.monthDay
      : null;
  if (frequency === "weekly" && weekdays.length === 0) return null;
  if (frequency === "monthly" && monthDay == null) return null;
  return { frequency, weekdays, monthDay, endDate: null };
}

function parseTemplate(value: unknown): TaskTemplate | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== "string" || value.id.length === 0) return null;
  if (typeof value.name !== "string" || value.name.trim().length === 0) {
    return null;
  }
  if (typeof value.title !== "string" || value.title.trim().length === 0) {
    return null;
  }
  if (typeof value.urgency !== "string" || !URGENCIES.has(value.urgency as Urgency)) {
    return null;
  }
  const countdownEnabled = Boolean(value.countdownEnabled);
  const plannedSeconds =
    typeof value.plannedSeconds === "number" && Number.isFinite(value.plannedSeconds)
      ? Math.max(60, value.plannedSeconds)
      : 25 * 60;
  const reminderTime = normalizeReminderTime(value.reminderTime);
  const reminderEnabled = Boolean(value.reminderEnabled) && reminderTime != null;
  const createdAt =
    typeof value.createdAt === "number" && Number.isFinite(value.createdAt)
      ? value.createdAt
      : Date.now();
  const updatedAt =
    typeof value.updatedAt === "number" && Number.isFinite(value.updatedAt)
      ? value.updatedAt
      : createdAt;
  return {
    id: value.id,
    name: value.name.trim().slice(0, 40),
    title: value.title.trim().slice(0, 120),
    urgency: value.urgency as Urgency,
    plannedSeconds,
    countdownEnabled,
    reminderEnabled,
    reminderTime: reminderEnabled ? reminderTime : null,
    recordTimeEnabled:
      typeof value.recordTimeEnabled === "boolean"
        ? value.recordTimeEnabled
        : true,
    recurrence: parseRecurrence(value.recurrence),
    sortOrder:
      typeof value.sortOrder === "number" && Number.isFinite(value.sortOrder)
        ? value.sortOrder
        : 1000,
    createdAt,
    updatedAt,
  };
}

function normalizeTemplates(templates: TaskTemplate[]): TaskTemplate[] {
  return [...templates]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt - b.createdAt)
    .map((template, index) => ({
      ...template,
      sortOrder: (index + 1) * 1000,
    }));
}

function parseDocument(value: unknown): TaskTemplateDocument | null {
  if (
    !isRecord(value) ||
    value.version !== TASK_TEMPLATE_DATA_VERSION ||
    !Array.isArray(value.templates)
  ) {
    return null;
  }
  const templates: TaskTemplate[] = [];
  for (const item of value.templates) {
    const template = parseTemplate(item);
    if (template == null) return null;
    templates.push(template);
  }
  return {
    version: TASK_TEMPLATE_DATA_VERSION,
    updatedAt:
      typeof value.updatedAt === "number" && Number.isFinite(value.updatedAt)
        ? value.updatedAt
        : Date.now(),
    templates: normalizeTemplates(templates),
  };
}

function createDocument(templates: readonly TaskTemplate[]): TaskTemplateDocument {
  return {
    version: TASK_TEMPLATE_DATA_VERSION,
    updatedAt: Date.now(),
    templates: normalizeTemplates([...templates]),
  };
}

export function createTaskTemplate(
  input: TaskTemplateInput,
  sortOrder: number,
  now = Date.now(),
  id = `template-${now}-${Math.random().toString(36).slice(2, 9)}`,
): TaskTemplate {
  const reminderTime = normalizeReminderTime(input.reminderTime);
  const recurrence = input.recurrence
    ? {
        ...input.recurrence,
        weekdays: [...new Set(input.recurrence.weekdays)].sort((a, b) => a - b),
        endDate: null,
      }
    : null;
  return {
    id,
    name: input.name.trim().slice(0, 40),
    title: input.title.trim().slice(0, 120),
    urgency: input.urgency,
    plannedSeconds: Math.max(60, input.plannedSeconds),
    countdownEnabled: input.countdownEnabled,
    reminderEnabled: input.reminderEnabled && reminderTime != null,
    reminderTime: input.reminderEnabled ? reminderTime : null,
    recordTimeEnabled: input.recordTimeEnabled,
    recurrence,
    sortOrder,
    createdAt: now,
    updatedAt: now,
  };
}

export function loadTaskTemplates(storage: StorageLike): LoadTaskTemplatesResult {
  const primary = parseDocument(parseJson(storage.getItem(TASK_TEMPLATE_STORAGE_KEY)));
  if (primary) {
    return { templates: primary.templates, source: "primary", notice: null };
  }
  const backup = parseDocument(parseJson(storage.getItem(TASK_TEMPLATE_BACKUP_KEY)));
  if (backup) {
    return {
      templates: backup.templates,
      source: "backup",
      notice: "模板主数据无法读取，已从本地备份恢复。",
    };
  }
  return { templates: [], source: "empty", notice: null };
}

export function saveTaskTemplates(
  templates: readonly TaskTemplate[],
  storage: StorageLike,
): SaveTaskTemplatesResult {
  try {
    const currentRaw = storage.getItem(TASK_TEMPLATE_STORAGE_KEY);
    if (parseDocument(parseJson(currentRaw)) != null) {
      storage.setItem(TASK_TEMPLATE_BACKUP_KEY, currentRaw ?? "");
    }
    storage.setItem(
      TASK_TEMPLATE_STORAGE_KEY,
      JSON.stringify(createDocument(templates)),
    );
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "无法保存任务模板。",
    };
  }
}
