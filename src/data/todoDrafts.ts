import type { TodoDraftSnapshot } from "../types";
import { deleteLocalRecords, readLocalRecord, writeLocalRecord } from "./localDatabase";

const cache = new Map<string, TodoDraftSnapshot | null>();
const pendingWrites = new Map<string, Promise<void>>();

export function parseTodoDraftSnapshot(value: unknown): TodoDraftSnapshot | null {
  if (typeof value !== "object" || value == null) return null;
  const snapshot = value as Partial<TodoDraftSnapshot>;
  const draft = snapshot.draft;
  if (
    draft == null ||
    typeof draft.title !== "string" ||
    typeof draft.date !== "string" ||
    typeof draft.taskTime !== "string" ||
    typeof draft.comment !== "string" ||
    typeof draft.subtaskTitles !== "string" ||
    !Array.isArray(draft.images) ||
    !["low", "medium", "high", "critical"].includes(draft.urgency) ||
    !Number.isFinite(draft.plannedSeconds) ||
    typeof draft.countdownEnabled !== "boolean" ||
    typeof draft.countdownOnlyEnabled !== "boolean" ||
    typeof draft.reminderEnabled !== "boolean" ||
    (draft.reminderTime !== null && typeof draft.reminderTime !== "string") ||
    typeof draft.recordTimeEnabled !== "boolean" ||
    !["single", "series"].includes(draft.recurrenceEditScope) ||
    typeof snapshot.countdownTargetTime !== "string" ||
    typeof snapshot.countdownTimeTouched !== "boolean"
  ) return null;
  if (draft.images.some((image) =>
    image == null || typeof image.id !== "string" || typeof image.name !== "string" ||
    (typeof image.dataUrl !== "string" && typeof image.fileName !== "string")
  )) return null;
  if (draft.recurrence !== null && (
    typeof draft.recurrence !== "object" ||
    !["daily", "weekdays", "weekly", "monthly"].includes(draft.recurrence.frequency) ||
    !Array.isArray(draft.recurrence.weekdays)
  )) return null;
  return { draft, countdownTargetTime: snapshot.countdownTargetTime, countdownTimeTouched: snapshot.countdownTimeTouched };
}

function enqueue(key: string, write: () => Promise<void>): Promise<void> {
  const pending = (pendingWrites.get(key) ?? Promise.resolve()).catch(() => {}).then(write);
  pendingWrites.set(key, pending);
  void pending.finally(() => {
    if (pendingWrites.get(key) === pending) pendingWrites.delete(key);
  }).catch(() => {});
  return pending;
}

export async function loadTodoDraft(key: string): Promise<TodoDraftSnapshot | null> {
  if (cache.has(key)) return cache.get(key) ?? null;
  const stored = await readLocalRecord("drafts", key);
  const snapshot = parseTodoDraftSnapshot(stored);
  if (!cache.has(key)) cache.set(key, snapshot);
  return cache.get(key) ?? null;
}

export function saveTodoDraft(key: string, snapshot: TodoDraftSnapshot): Promise<void> {
  cache.set(key, snapshot);
  return enqueue(key, () => writeLocalRecord("drafts", key, snapshot));
}

export async function removeTodoDraft(key: string): Promise<void> {
  await enqueue(key, async () => { await deleteLocalRecords("drafts", (storedKey) => storedKey === key); });
  cache.set(key, null);
}
