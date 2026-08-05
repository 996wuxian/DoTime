import type {
  RecurrenceRule,
  RecurrenceTemplate,
  Todo,
  TodoSubtask,
  Urgency,
} from "../types";
import {
  RECURRENCE_LABELS,
  URGENCY_LABELS,
  URGENCY_ORDER,
} from "../types";
import { normalizeRecurrenceRule } from "../domain/recurrence";
import { normalizeReminderTime } from "../utils/reminders";
import { formatDisplayDate, formatDurationHuman } from "../utils/time";

export const APP_DATA_VERSION = 2 as const;
export const APP_DATA_STORAGE_KEY = "dotime-app-data-v2";
export const LEGACY_TODO_STORAGE_KEY = "dotime-todos-v1";
export const LEGACY_MANUAL_SORT_DATES_STORAGE_KEY =
  "dotime-manual-sort-dates-v1";

const BACKUP_COUNT = 3;
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const URGENCIES = new Set<Urgency>(["low", "medium", "high", "critical"]);
const TEXT_LINE_BREAK = "\r\n";
const TEXT_SEPARATOR = "-".repeat(60);
const TEXT_DATE_SEPARATOR = "=".repeat(60);
const DATE_TIME_FORMATTER = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

export type StorageLike = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>;

export interface AppDataDocument {
  version: typeof APP_DATA_VERSION;
  updatedAt: number;
  todos: Todo[];
  manualSortDates: string[];
}

export interface LoadAppDataResult {
  data: AppDataDocument;
  source: "primary" | "backup" | "legacy" | "empty";
  notice: string | null;
}

export type ImportAppDataResult =
  | { ok: true; data: AppDataDocument }
  | { ok: false; error: string };

export type SaveAppDataResult =
  | { ok: true }
  | { ok: false; error: string };

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value != null && !Array.isArray(value);
}

function isUrgency(value: unknown): value is Urgency {
  return typeof value === "string" && URGENCIES.has(value as Urgency);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isDateKey(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_KEY_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

function getInitialOrderRank(todo: Todo): number {
  if (todo.isTiming) return 0;
  if (!todo.completed) return 1;
  return 2;
}

function compareInitialOrder(a: Todo, b: Todo): number {
  const rankDiff = getInitialOrderRank(a) - getInitialOrderRank(b);
  if (rankDiff !== 0) return rankDiff;

  const urgencyDiff = URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency];
  if (urgencyDiff !== 0) return urgencyDiff;
  return b.createdAt - a.createdAt;
}

export function normalizeTodoSortOrders(todos: Todo[]): Todo[] {
  const todosByDate = new Map<string, Todo[]>();
  for (const todo of todos) {
    const dateTodos = todosByDate.get(todo.date) ?? [];
    dateTodos.push(todo);
    todosByDate.set(todo.date, dateTodos);
  }

  const sortOrderById = new Map<string, number>();
  for (const dateTodos of todosByDate.values()) {
    const needsMigration = dateTodos.some(
      (todo) => !Number.isFinite(todo.sortOrder),
    );
    const ordered = [...dateTodos].sort(
      needsMigration
        ? compareInitialOrder
        : (a, b) => a.sortOrder - b.sortOrder,
    );

    ordered.forEach((todo, index) => {
      sortOrderById.set(todo.id, (index + 1) * 1000);
    });
  }

  return todos.map((todo) => ({
    ...todo,
    sortOrder: sortOrderById.get(todo.id) ?? todo.sortOrder,
  }));
}

function parseTodo(value: unknown): Todo | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== "string" || value.id.length === 0) return null;
  if (typeof value.title !== "string" || value.title.trim().length === 0) {
    return null;
  }
  if (!isDateKey(value.date)) return null;

  const plannedSeconds = isFiniteNumber(value.plannedSeconds)
    ? Math.max(0, value.plannedSeconds)
    : 0;
  const elapsedSeconds = isFiniteNumber(value.elapsedSeconds)
    ? Math.max(0, value.elapsedSeconds)
    : 0;
  const reminderTime = normalizeReminderTime(value.reminderTime);

  const recurrence = isRecord(value.recurrence)
    ? normalizeRecurrenceRule(
        {
          frequency:
            value.recurrence.frequency === "daily" ||
            value.recurrence.frequency === "weekdays" ||
            value.recurrence.frequency === "weekly" ||
            value.recurrence.frequency === "monthly"
              ? value.recurrence.frequency
              : "daily",
          weekdays: Array.isArray(value.recurrence.weekdays)
            ? value.recurrence.weekdays.filter(isFiniteNumber)
            : [],
          monthDay: isFiniteNumber(value.recurrence.monthDay)
            ? value.recurrence.monthDay
            : null,
          endDate: isDateKey(value.recurrence.endDate)
            ? value.recurrence.endDate
            : null,
        },
        value.date,
      )
    : null;
  const recurrenceTemplate = recurrence != null
    ? parseRecurrenceTemplate(value.recurrenceTemplate, value)
    : null;

  return {
    id: value.id,
    title: value.title.trim(),
    urgency: isUrgency(value.urgency) ? value.urgency : "medium",
    date: value.date,
    sortOrder: isFiniteNumber(value.sortOrder) ? value.sortOrder : Number.NaN,
    plannedSeconds,
    countdownEnabled:
      typeof value.countdownEnabled === "boolean"
        ? value.countdownEnabled
        : plannedSeconds > 0,
    reminderEnabled: Boolean(value.reminderEnabled) && reminderTime != null,
    reminderTime,
    recordTimeEnabled:
      typeof value.recordTimeEnabled === "boolean"
        ? value.recordTimeEnabled
        : true,
    reminderSnoozedUntil: isFiniteNumber(value.reminderSnoozedUntil)
      ? value.reminderSnoozedUntil
      : null,
    reminderLastFiredAt: isFiniteNumber(value.reminderLastFiredAt)
      ? value.reminderLastFiredAt
      : null,
    completed: Boolean(value.completed),
    isTiming: Boolean(value.isTiming),
    timingStartedAt: isFiniteNumber(value.timingStartedAt)
      ? value.timingStartedAt
      : null,
    elapsedSeconds,
    actualDurationSeconds: isFiniteNumber(value.actualDurationSeconds)
      ? Math.max(0, value.actualDurationSeconds)
      : null,
    comment: typeof value.comment === "string" ? value.comment : "",
    favorite: Boolean(value.favorite),
    createdAt: isFiniteNumber(value.createdAt) ? value.createdAt : Date.now(),
    completedAt: isFiniteNumber(value.completedAt) ? value.completedAt : null,
    recurrenceSeriesId:
      recurrence != null && typeof value.recurrenceSeriesId === "string"
        ? value.recurrenceSeriesId
        : null,
    recurrence,
    recurrenceTemplate,
    subtasks: parseTodoSubtasks(value.subtasks),
  };
}

function parseRecurrenceTemplate(
  value: unknown,
  fallback: UnknownRecord,
): RecurrenceTemplate {
  const template = isRecord(value) ? value : fallback;
  const plannedSeconds = isFiniteNumber(template.plannedSeconds)
    ? Math.max(0, template.plannedSeconds)
    : 0;
  const reminderTime = normalizeReminderTime(template.reminderTime);

  return {
    title:
      typeof template.title === "string" && template.title.trim()
        ? template.title.trim()
        : String(fallback.title),
    urgency: isUrgency(template.urgency) ? template.urgency : "medium",
    plannedSeconds,
    countdownEnabled:
      typeof template.countdownEnabled === "boolean"
        ? template.countdownEnabled
        : plannedSeconds > 0,
    reminderEnabled: Boolean(template.reminderEnabled) && reminderTime != null,
    reminderTime,
    recordTimeEnabled:
      typeof template.recordTimeEnabled === "boolean"
        ? template.recordTimeEnabled
        : true,
  };
}

function parseTodoSubtask(value: unknown, depth: number): TodoSubtask | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== "string" || value.id.length === 0) return null;
  if (typeof value.title !== "string" || value.title.trim().length === 0) {
    return null;
  }

  const children =
    depth < 2 && Array.isArray(value.children)
      ? value.children
          .map((child) => parseTodoSubtask(child, depth + 1))
          .filter((child): child is TodoSubtask => child != null)
      : [];

  return {
    id: value.id,
    title: value.title.trim(),
    urgency: isUrgency(value.urgency) ? value.urgency : "medium",
    plannedSeconds: isFiniteNumber(value.plannedSeconds)
      ? Math.max(0, value.plannedSeconds)
      : 0,
    countdownEnabled:
      typeof value.countdownEnabled === "boolean"
        ? value.countdownEnabled
        : false,
    recordTimeEnabled:
      typeof value.recordTimeEnabled === "boolean"
        ? value.recordTimeEnabled
        : false,
    completed: Boolean(value.completed),
    isTiming: Boolean(value.isTiming),
    timingStartedAt: isFiniteNumber(value.timingStartedAt)
      ? value.timingStartedAt
      : null,
    elapsedSeconds: isFiniteNumber(value.elapsedSeconds)
      ? Math.max(0, value.elapsedSeconds)
      : 0,
    actualDurationSeconds: isFiniteNumber(value.actualDurationSeconds)
      ? Math.max(0, value.actualDurationSeconds)
      : null,
    createdAt: isFiniteNumber(value.createdAt) ? value.createdAt : Date.now(),
    completedAt: isFiniteNumber(value.completedAt) ? value.completedAt : null,
    children,
  };
}

function parseTodoSubtasks(value: unknown): TodoSubtask[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => parseTodoSubtask(item, 1))
    .filter((item): item is TodoSubtask => item != null);
}

function parseTodos(value: unknown): Todo[] | null {
  if (!Array.isArray(value)) return null;

  const todos: Todo[] = [];
  for (const item of value) {
    const todo = parseTodo(item);
    if (todo == null) return null;
    todos.push(todo);
  }
  return normalizeTodoSortOrders(todos);
}

function parseManualSortDates(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(isDateKey))];
}

function createDocument(
  todos: Todo[],
  manualSortDates: Iterable<string>,
  updatedAt = Date.now(),
): AppDataDocument {
  return {
    version: APP_DATA_VERSION,
    updatedAt,
    todos: normalizeTodoSortOrders(todos),
    manualSortDates: [...new Set([...manualSortDates].filter(isDateKey))],
  };
}

function parseDocument(value: unknown): AppDataDocument | null {
  if (!isRecord(value) || value.version !== APP_DATA_VERSION) return null;
  const todos = parseTodos(value.todos);
  if (todos == null) return null;

  return createDocument(
    todos,
    parseManualSortDates(value.manualSortDates),
    isFiniteNumber(value.updatedAt) ? value.updatedAt : Date.now(),
  );
}

function parseJson(raw: string | null): unknown {
  if (raw == null) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function getBackupKey(index: number): string {
  return `${APP_DATA_STORAGE_KEY}-backup-${index}`;
}

export function createAppDataDocument(
  todos: Todo[],
  manualSortDates: Iterable<string>,
): AppDataDocument {
  return createDocument(todos, manualSortDates);
}

export function loadAppData(storage: StorageLike): LoadAppDataResult {
  const primary = parseDocument(parseJson(storage.getItem(APP_DATA_STORAGE_KEY)));
  if (primary != null) {
    return { data: primary, source: "primary", notice: null };
  }

  for (let index = 1; index <= BACKUP_COUNT; index += 1) {
    const backup = parseDocument(parseJson(storage.getItem(getBackupKey(index))));
    if (backup != null) {
      return {
        data: backup,
        source: "backup",
        notice: `主数据无法读取，已从第 ${index} 份备份恢复。`,
      };
    }
  }

  const legacyTodos = parseTodos(
    parseJson(storage.getItem(LEGACY_TODO_STORAGE_KEY)),
  );
  if (legacyTodos != null) {
    const legacyDates = parseManualSortDates(
      parseJson(storage.getItem(LEGACY_MANUAL_SORT_DATES_STORAGE_KEY)),
    );
    return {
      data: createDocument(legacyTodos, legacyDates),
      source: "legacy",
      notice: "本地数据已升级到 v2 格式。",
    };
  }

  return {
    data: createDocument([], []),
    source: "empty",
    notice: null,
  };
}

export function saveAppData(
  data: AppDataDocument,
  storage: StorageLike,
): SaveAppDataResult {
  try {
    const nextData = createDocument(data.todos, data.manualSortDates);
    const nextRaw = JSON.stringify(nextData);
    const currentRaw = storage.getItem(APP_DATA_STORAGE_KEY);
    const current = parseDocument(parseJson(currentRaw));

    if (current != null && currentRaw !== nextRaw) {
      for (let index = BACKUP_COUNT; index >= 2; index -= 1) {
        const previous = storage.getItem(getBackupKey(index - 1));
        if (previous == null) {
          storage.removeItem(getBackupKey(index));
        } else {
          storage.setItem(getBackupKey(index), previous);
        }
      }
      storage.setItem(getBackupKey(1), JSON.stringify(current));
    }

    storage.setItem(APP_DATA_STORAGE_KEY, nextRaw);
    storage.setItem(LEGACY_TODO_STORAGE_KEY, JSON.stringify(nextData.todos));
    storage.setItem(
      LEGACY_MANUAL_SORT_DATES_STORAGE_KEY,
      JSON.stringify(nextData.manualSortDates),
    );
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "无法保存本地数据。",
    };
  }
}

function formatTimestamp(value: number | null): string {
  return value == null ? "无" : DATE_TIME_FORMATTER.format(new Date(value));
}

function formatTodoStatus(todo: Todo): string {
  if (todo.completed) return "已完成";
  if (todo.isTiming) return "计时中";
  return "待开始";
}

function formatTodoTextBlock(todo: Todo, index: number): string {
  const lines = [
    `待办 ${index + 1}`,
    `标题：${todo.title}`,
    `状态：${formatTodoStatus(todo)}`,
    `紧急程度：${URGENCY_LABELS[todo.urgency]}`,
    `创建时间：${formatTimestamp(todo.createdAt)}`,
    `倒计时：${
      todo.countdownEnabled
        ? formatDurationHuman(todo.plannedSeconds)
        : "未开启"
    }`,
    `提醒：${
      todo.reminderEnabled && todo.reminderTime
        ? todo.reminderTime
        : "未开启"
    }`,
    `时间记录：${todo.recordTimeEnabled ? "已开启" : "未开启"}`,
    `累计耗时：${formatDurationHuman(todo.elapsedSeconds)}`,
  ];

  if (todo.recurrence != null) {
    lines.push(`重复：${formatRecurrenceRule(todo.recurrence)}`);
  }

  if (todo.reminderSnoozedUntil != null) {
    lines.push(`稍后提醒：${formatTimestamp(todo.reminderSnoozedUntil)}`);
  }
  if (todo.actualDurationSeconds != null) {
    lines.push(
      `完成耗时：${formatDurationHuman(todo.actualDurationSeconds)}`,
    );
  }
  if (todo.completedAt != null) {
    lines.push(`完成时间：${formatTimestamp(todo.completedAt)}`);
  }
  if (todo.subtasks != null && todo.subtasks.length > 0) {
    lines.push("子待办：");
    for (const subtask of todo.subtasks) {
      lines.push(
        `  ${subtask.completed ? "[x]" : "[ ]"} ${subtask.title}（${
          URGENCY_LABELS[subtask.urgency]
        }）`,
      );
      for (const child of subtask.children) {
        lines.push(
          `    ${child.completed ? "[x]" : "[ ]"} ${child.title}（${
            URGENCY_LABELS[child.urgency]
          }）`,
        );
      }
    }
  }

  return lines.join(TEXT_LINE_BREAK);
}

function formatRecurrenceRule(rule: RecurrenceRule): string {
  const parts = [RECURRENCE_LABELS[rule.frequency]];
  if (rule.frequency === "weekly" && rule.weekdays.length > 0) {
    const weekdayLabels = ["一", "二", "三", "四", "五", "六", "日"];
    parts.push(
      rule.weekdays.map((day) => `周${weekdayLabels[day - 1]}`).join("、"),
    );
  }
  if (rule.frequency === "monthly" && rule.monthDay != null) {
    parts.push(`${rule.monthDay} 日`);
  }
  if (rule.endDate != null) parts.push(`截至 ${formatDisplayDate(rule.endDate)}`);
  return parts.join(" · ");
}

export function exportAppDataAsText(
  data: AppDataDocument,
  date?: string,
): string {
  const exportedTodos =
    date == null ? data.todos : data.todos.filter((todo) => todo.date === date);
  const orderedTodos = [...exportedTodos].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.sortOrder - b.sortOrder ||
      a.createdAt - b.createdAt,
  );
  const todosByDate = new Map<string, Todo[]>();
  for (const todo of orderedTodos) {
    const dateTodos = todosByDate.get(todo.date) ?? [];
    dateTodos.push(todo);
    todosByDate.set(todo.date, dateTodos);
  }

  const header = [
    "doTime 待办文档",
    `导出时间：${DATE_TIME_FORMATTER.format(new Date())}`,
    `导出范围：${date == null ? "全部日期" : formatDisplayDate(date)}`,
    `待办总数：${orderedTodos.length}`,
  ].join(TEXT_LINE_BREAK);

  if (orderedTodos.length === 0) {
    return `${header}${TEXT_LINE_BREAK.repeat(2)}暂无待办。${TEXT_LINE_BREAK}`;
  }

  const dateSections = [...todosByDate.entries()].map(([date, todos]) => {
    const blocks = todos.map(formatTodoTextBlock).join(
      `${TEXT_LINE_BREAK.repeat(2)}${TEXT_SEPARATOR}${TEXT_LINE_BREAK.repeat(2)}`,
    );
    return [
      `日期：${formatDisplayDate(date)}（${todos.length} 个待办）`,
      TEXT_DATE_SEPARATOR,
      "",
      blocks,
    ].join(TEXT_LINE_BREAK);
  });

  return [
    header,
    "",
    TEXT_DATE_SEPARATOR,
    "",
    dateSections.join(
      `${TEXT_LINE_BREAK.repeat(2)}${TEXT_DATE_SEPARATOR}${TEXT_LINE_BREAK.repeat(2)}`,
    ),
    "",
  ].join(TEXT_LINE_BREAK);
}

export function parseImportedAppData(text: string): ImportAppDataResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return { ok: false, error: "文件不是有效的 JSON。" };
  }

  const document = parseDocument(parsed);
  if (document != null) return { ok: true, data: document };

  const legacyTodos = parseTodos(parsed);
  if (legacyTodos != null) {
    return { ok: true, data: createDocument(legacyTodos, []) };
  }

  if (isRecord(parsed) && typeof parsed.version === "number") {
    return { ok: false, error: `暂不支持 v${parsed.version} 数据文件。` };
  }
  return { ok: false, error: "数据结构无效或包含损坏的待办。" };
}
