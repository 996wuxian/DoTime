import { useCallback, useEffect, useMemo, useState } from "react";
import type { Todo } from "../types";
import {
  SNOOZE_MINUTES,
  TODO_STORAGE_KEY,
  type ActiveReminderGroup,
  mergeActiveReminderItems,
  readActiveReminderGroup,
  saveActiveReminderGroup,
} from "../utils/reminders";
import {
  IconAlarmSnooze,
  IconBellRinging,
  IconChevronDown,
  IconClose,
} from "./icons";

const REMINDER_GROUP_EVENT = "dotime-reminder-group";
const REMINDER_UPDATED_EVENT = "dotime-reminder-updated";

type ReminderAction = "dismiss" | "snooze";

function formatClockTime(value: number) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function parseReminderGroup(value: unknown): ActiveReminderGroup | null {
  if (typeof value !== "string") return null;

  try {
    const parsed = JSON.parse(value) as ActiveReminderGroup;
    if (!parsed || !Array.isArray(parsed.items) || parsed.items.length === 0) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function loadTodos(): Todo[] {
  try {
    const raw = localStorage.getItem(TODO_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Todo[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveTodos(todos: Todo[]) {
  localStorage.setItem(TODO_STORAGE_KEY, JSON.stringify(todos));
}

async function emitReminderUpdated() {
  const { emit } = await import("@tauri-apps/api/event");
  await emit(REMINDER_UPDATED_EVENT);
}

async function clearActiveReminder() {
  saveActiveReminderGroup(null);
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("clear_active_reminder_group");
}

async function closeReminderWindow() {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("close_reminder_window");
}

export function ReminderPopup() {
  const [group, setGroup] = useState<ActiveReminderGroup | null>(null);
  const [snoozeMinutes, setSnoozeMinutes] =
    useState<(typeof SNOOZE_MINUTES)[number]>(10);
  const [snoozeMenuOpen, setSnoozeMenuOpen] = useState(false);

  const sortedItems = useMemo(
    () => [...(group?.items ?? [])].sort((a, b) => a.dueAt - b.dueAt),
    [group],
  );
  const itemCount = sortedItems.length;

  const closeIfEmpty = useCallback(
    async (nextGroup: ActiveReminderGroup | null) => {
      if (nextGroup != null && nextGroup.items.length > 0) return;
      await clearActiveReminder();
      await closeReminderWindow();
    },
    [],
  );

  const applyAction = useCallback(
    async (action: ReminderAction, ids: string[]) => {
      const uniqueIds = [...new Set(ids)];
      if (uniqueIds.length === 0 || group == null) return;

      const idSet = new Set(uniqueIds);
      const now = Date.now();
      const snoozedUntil =
        action === "snooze" ? now + snoozeMinutes * 60 * 1000 : null;

      const todos = loadTodos();
      saveTodos(
        todos.map((todo) =>
          idSet.has(todo.id)
            ? {
                ...todo,
                reminderLastFiredAt: now,
                reminderSnoozedUntil: snoozedUntil,
              }
            : todo,
        ),
      );

      const nextItems = group.items.filter((item) => !idSet.has(item.id));
      const nextGroup =
        nextItems.length > 0
          ? { ...group, updatedAt: now, items: nextItems }
          : null;

      saveActiveReminderGroup(nextGroup);
      setGroup(nextGroup);
      await emitReminderUpdated();
      await closeIfEmpty(nextGroup);
      setSnoozeMenuOpen(false);
    },
    [closeIfEmpty, group, snoozeMinutes],
  );

  const dismissAll = useCallback(
    () => {
      if (sortedItems.length === 0) {
        void closeIfEmpty(null);
        return;
      }
      void applyAction(
        "dismiss",
        sortedItems.map((item) => item.id),
      );
    },
    [applyAction, closeIfEmpty, sortedItems],
  );

  const snoozeAll = useCallback(
    () =>
      applyAction(
        "snooze",
        sortedItems.map((item) => item.id),
      ),
    [applyAction, sortedItems],
  );

  useEffect(() => {
    document.body.classList.add("is-reminder-window");
    return () => document.body.classList.remove("is-reminder-window");
  }, []);

  useEffect(() => {
    if (!snoozeMenuOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSnoozeMenuOpen(false);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [snoozeMenuOpen]);

  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | undefined;

    void (async () => {
      const [{ invoke }, { listen }] = await Promise.all([
        import("@tauri-apps/api/core"),
        import("@tauri-apps/api/event"),
      ]);

      const activeGroup = parseReminderGroup(
        await invoke<string | null>("get_active_reminder_group"),
      ) ?? readActiveReminderGroup();
      if (!disposed) setGroup(activeGroup);

      cleanup = await listen<string>(REMINDER_GROUP_EVENT, (event) => {
        const incomingGroup = parseReminderGroup(event.payload);
        const nextGroup =
          incomingGroup == null
            ? null
            : mergeActiveReminderItems(
                readActiveReminderGroup(),
                incomingGroup.items,
                incomingGroup.updatedAt,
              );
        saveActiveReminderGroup(nextGroup);
        setGroup(nextGroup);
      });
    })();

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, []);

  return (
    <main className="reminder-window" aria-label="待办提醒">
      <section
        className={`reminder-toast ${itemCount === 0 ? "is-empty" : ""}`}
      >
        <div className="reminder-toast__header">
          <div className="reminder-toast__icon" aria-hidden>
            <IconBellRinging size={22} />
          </div>
          <div className="reminder-toast__title">
            <h1>待办提醒</h1>
            <p>
              {itemCount > 0 ? `${itemCount} 个待办已到提醒时间` : "暂无提醒"}
            </p>
          </div>
          <button
            type="button"
            className="reminder-toast__icon-btn"
            aria-label="关闭提醒窗口"
            onClick={dismissAll}
          >
            <IconClose size={17} />
          </button>
        </div>

        <div className="reminder-toast__list" role="list">
          {sortedItems.map((item) => (
            <div
              className="reminder-toast__item"
              role="listitem"
              key={item.id}
            >
              <div>
                <span className="reminder-toast__item-title">{item.title}</span>
                <span className="reminder-toast__item-time">
                  {formatClockTime(item.dueAt)}
                </span>
              </div>
              <button
                type="button"
                className="reminder-toast__item-close"
                aria-label={`关闭 ${item.title} 的提醒`}
                onClick={() => applyAction("dismiss", [item.id])}
              >
                <IconClose size={15} />
              </button>
            </div>
          ))}
        </div>

        <div className="reminder-toast__actions">
          {itemCount > 0 && (
            <>
              <div className="reminder-toast__snooze">
                <button
                  type="button"
                  className="reminder-toast__snooze-trigger"
                  aria-haspopup="listbox"
                  aria-expanded={snoozeMenuOpen}
                  onClick={() => setSnoozeMenuOpen((open) => !open)}
                >
                  <IconAlarmSnooze size={15} />
                  <span>{snoozeMinutes} 分钟后</span>
                  <IconChevronDown size={14} />
                </button>
                {snoozeMenuOpen && (
                  <div className="reminder-toast__snooze-menu" role="listbox">
                    {SNOOZE_MINUTES.map((minutes) => (
                      <button
                        key={minutes}
                        type="button"
                        className={`reminder-toast__snooze-option ${
                          snoozeMinutes === minutes ? "is-active" : ""
                        }`}
                        role="option"
                        aria-selected={snoozeMinutes === minutes}
                        onClick={() => {
                          setSnoozeMinutes(minutes);
                          setSnoozeMenuOpen(false);
                        }}
                      >
                        {minutes} 分钟后
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button
                type="button"
                className="btn btn-secondary reminder-toast__action"
                onClick={snoozeAll}
              >
                稍后
              </button>
            </>
          )}
          <button
            type="button"
            className="btn btn-primary reminder-toast__action"
            onClick={dismissAll}
          >
            关闭
          </button>
        </div>
      </section>
    </main>
  );
}
