import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  REMINDER_ACTION_EVENT,
  REMINDER_GROUP_EVENT,
  SNOOZE_MINUTES,
  type ActiveReminderGroup,
  type ReminderActionPayload,
  mergeActiveReminderItems,
  readActiveReminderGroup,
  saveActiveReminderGroup,
} from "../utils/reminders";
import {
  IconAlarmSnooze,
  IconBellRinging,
  IconChevronDown,
  IconCheck,
  IconClock,
  IconClose,
} from "./icons";

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

async function emitReminderAction(payload: ReminderActionPayload) {
  const { emit } = await import("@tauri-apps/api/event");
  await emit(REMINDER_ACTION_EVENT, payload);
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
  const [actionError, setActionError] = useState<string | null>(null);
  const snoozeRef = useRef<HTMLDivElement>(null);

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
    async (action: ReminderActionPayload["action"], ids: string[]) => {
      const uniqueIds = [...new Set(ids)];
      if (uniqueIds.length === 0 || group == null) return;

      const idSet = new Set(uniqueIds);
      const now = Date.now();
      const snoozedUntil =
        action === "snooze" ? now + snoozeMinutes * 60 * 1000 : null;

      const nextItems = group.items.filter((item) => !idSet.has(item.id));
      const nextGroup =
        nextItems.length > 0
          ? { ...group, updatedAt: now, items: nextItems }
          : null;

      try {
        setActionError(null);
        await emitReminderAction({
          action,
          ids: uniqueIds,
          firedAt: now,
          snoozedUntil,
        });
        saveActiveReminderGroup(nextGroup);
        setGroup(nextGroup);
        await closeIfEmpty(nextGroup);
        setSnoozeMenuOpen(false);
      } catch {
        setActionError("提醒状态保存失败，请重试。");
      }
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
      if (event.key === "Escape") {
        setSnoozeMenuOpen(false);
        snoozeRef.current?.querySelector<HTMLButtonElement>(
          ".reminder-toast__snooze-trigger",
        )?.focus();
      }
    };
    const handlePointerDown = (event: PointerEvent) => {
      if (!snoozeRef.current?.contains(event.target as Node)) {
        setSnoozeMenuOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("pointerdown", handlePointerDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("pointerdown", handlePointerDown);
    };
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
              {itemCount > 1
                ? `${itemCount} 个待办到了提醒时间`
                : itemCount === 1
                  ? "你设置的提醒时间到了"
                  : "暂无待办需要提醒"}
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

        <div className="reminder-toast__content">
          {actionError && (
            <p className="reminder-toast__error" role="alert">
              {actionError}
            </p>
          )}
          <div className="reminder-toast__list" role="list">
            {sortedItems.map((item) => (
              <div
                className="reminder-toast__item"
                role="listitem"
                key={item.id}
              >
                <div>
                  <span className="reminder-toast__item-title" title={item.title}>
                    {item.title}
                  </span>
                  <span className="reminder-toast__item-time">
                    <IconClock size={13} />
                    <time dateTime={new Date(item.dueAt).toISOString()}>
                      {formatClockTime(item.dueAt)}
                    </time>
                    <span>提醒</span>
                  </span>
                </div>
                {itemCount > 1 && (
                  <button
                    type="button"
                    className="reminder-toast__item-close"
                    aria-label={`关闭 ${item.title} 的提醒`}
                    onClick={() => applyAction("dismiss", [item.id])}
                  >
                    <IconClose size={15} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="reminder-toast__actions">
          {itemCount > 0 && (
            <>
              <div className="reminder-toast__snooze" ref={snoozeRef}>
                <button
                  type="button"
                  className="btn btn-primary reminder-toast__snooze-action"
                  onClick={snoozeAll}
                >
                  <IconAlarmSnooze size={16} />
                  <span>{snoozeMinutes} 分钟后提醒</span>
                </button>
                <button
                  type="button"
                  className="reminder-toast__snooze-trigger"
                  aria-haspopup="listbox"
                  aria-expanded={snoozeMenuOpen}
                  aria-controls="reminder-snooze-options"
                  aria-label="更改稍后提醒时间"
                  onClick={() => setSnoozeMenuOpen((open) => !open)}
                >
                  <IconChevronDown size={14} />
                </button>
                {snoozeMenuOpen && (
                  <div
                    className="reminder-toast__snooze-menu"
                    id="reminder-snooze-options"
                    role="listbox"
                    aria-label="稍后提醒时间"
                  >
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
                          snoozeRef.current?.querySelector<HTMLButtonElement>(
                            ".reminder-toast__snooze-trigger",
                          )?.focus();
                        }}
                      >
                        <span>{minutes} 分钟后</span>
                        {snoozeMinutes === minutes && <IconCheck size={14} />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
          <button
            type="button"
            className="btn btn-secondary reminder-toast__action"
            onClick={dismissAll}
          >
            知道了
          </button>
        </div>
      </section>
    </main>
  );
}
