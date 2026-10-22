import type { TodoDraft, TodoDraftSnapshot } from "../types";
import { getDefaultReminderTime, normalizeReminderTime } from "./reminders";
import { formatClockTime, formatDateKey } from "./time";

export function createDefaultTodoDraft(date = formatDateKey()): TodoDraft {
  return {
    title: "", date, taskTime: formatClockTime(Date.now()), comment: "", subtaskTitles: "",
    images: [], urgency: "medium", plannedSeconds: 25 * 60, countdownEnabled: false,
    countdownOnlyEnabled: false, reminderEnabled: false, reminderTime: getDefaultReminderTime(),
    recordTimeEnabled: false, recurrence: null, recurrenceEditScope: "series",
  };
}

export function getCountdownSecondsUntil(time: string, nowMs = Date.now()): number {
  const normalized = normalizeReminderTime(time);
  if (normalized == null) return 60;
  const [hour, minute] = normalized.split(":").map(Number);
  const target = new Date(nowMs);
  target.setHours(hour, minute, 0, 0);
  if (target.getTime() <= nowMs) target.setDate(target.getDate() + 1);
  return Math.max(60, Math.ceil((target.getTime() - nowMs) / 1000));
}

export function prepareTodoDraft(snapshot: TodoDraftSnapshot, nowMs = Date.now()): TodoDraft {
  const { draft } = snapshot;
  return {
    ...draft,
    title: draft.title.trim(),
    plannedSeconds: draft.countdownEnabled && snapshot.countdownTimeTouched
      ? getCountdownSecondsUntil(snapshot.countdownTargetTime, nowMs)
      : draft.plannedSeconds,
    countdownOnlyEnabled: draft.countdownEnabled && draft.countdownOnlyEnabled,
    recordTimeEnabled: draft.countdownEnabled || draft.recordTimeEnabled,
    reminderTime: draft.reminderEnabled ? normalizeReminderTime(draft.reminderTime) : null,
  };
}

export function parseSubtaskTitles(value: string): string[] {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 20);
}

export function getDraftExtras(draft: TodoDraft): string[] {
  const extras: string[] = [];
  if (draft.reminderEnabled) extras.push(`提醒 ${draft.reminderTime ?? ""}`.trim());
  if (draft.comment.trim()) extras.push("有备注");
  const subtaskCount = parseSubtaskTitles(draft.subtaskTitles).length;
  if (subtaskCount > 0) extras.push(`${subtaskCount} 个子待办`);
  if (draft.recurrence != null) extras.push("重复任务");
  if (draft.images.length > 0) extras.push(`${draft.images.length} 张图片`);
  return extras;
}
