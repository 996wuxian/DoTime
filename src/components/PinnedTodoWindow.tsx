import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
} from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import {
  APP_DATA_STORAGE_KEY,
  createAppDataDocument,
  loadAppData,
  saveAppData,
} from "../data/appData";
import { toggleTodoCompletionWithRecurrence } from "../domain/todoState";
import { emitAppDataUpdated } from "../utils/appDataEvents";
import { URGENCY_LABELS } from "../types";
import {
  buildPinnedTodoPayload,
  parsePinnedTodoPayload,
  pinnedTodoEventForSlot,
  type PinnedTodoPayload,
} from "../utils/pinnedTodo";
import { formatDisplayDate, formatDuration } from "../utils/time";
import {
  IconBell,
  IconCheck,
  IconClock,
  IconClockHour4,
  IconListCheck,
} from "./icons";

const PINNED_TODO_COLLAPSED_WIDTH = 210;
const PINNED_TODO_EXPANDED_WIDTH = 420;
const PINNED_TODO_COLLAPSED_HEIGHT = 46;
const PINNED_TODO_EXPANDED_HEIGHT = 60;

function getLiveElapsed(todo: PinnedTodoPayload, now: number) {
  if (todo.isTiming && todo.timingStartedAt != null) {
    return todo.elapsedSeconds + Math.floor((now - todo.timingStartedAt) / 1000);
  }
  return todo.elapsedSeconds;
}

async function removePinnedTodo(slot: string) {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("remove_pinned_todo", { slot });
}

async function syncPinnedTodoWindowFrame(expanded: boolean) {
  const {
    currentMonitor,
    getCurrentWindow,
    LogicalPosition,
    LogicalSize,
  } = await import("@tauri-apps/api/window");

  const window = getCurrentWindow();
  const monitor = await currentMonitor();
  if (monitor == null) return;

  const workPosition = monitor.workArea.position.toLogical(monitor.scaleFactor);
  const workSize = monitor.workArea.size.toLogical(monitor.scaleFactor);
  const currentPosition = (await window.outerPosition()).toLogical(
    monitor.scaleFactor,
  );
  const currentSize = (await window.outerSize()).toLogical(monitor.scaleFactor);
  const width = expanded
    ? PINNED_TODO_EXPANDED_WIDTH
    : PINNED_TODO_COLLAPSED_WIDTH;
  const height = expanded
    ? PINNED_TODO_EXPANDED_HEIGHT
    : PINNED_TODO_COLLAPSED_HEIGHT;
  const currentRight = currentPosition.x + currentSize.width;
  const maxRight = workPosition.x + workSize.width;
  const right = Math.min(Math.max(currentRight, workPosition.x + width), maxRight);
  const x = right - width;

  await window.setPosition(new LogicalPosition(x, currentPosition.y));
  await window.setSize(new LogicalSize(width, height));
}

function togglePinnedTodoCompletion(todoId: string) {
  const result = loadAppData(localStorage);
  const nextTodos = toggleTodoCompletionWithRecurrence(
    result.data.todos,
    todoId,
    Date.now(),
  );
  const saveResult = saveAppData(
    createAppDataDocument(
      nextTodos,
      result.data.manualSortDates,
      result.data.categoryDividers,
    ),
    localStorage,
  );

  if (!saveResult.ok) {
    throw new Error(saveResult.error);
  }

  void emitAppDataUpdated().catch((error) => {
    console.error("failed to emit app data update", error);
  });

  return nextTodos.find((item) => item.id === todoId) ?? null;
}

export function PinnedTodoWindow() {
  const [todo, setTodo] = useState<PinnedTodoPayload | null>(null);
  const [now, setNow] = useState(Date.now());
  const [expanded, setExpanded] = useState(false);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const collapseTimerRef = useRef<number | null>(null);
  const hoverLockUntilRef = useRef(0);
  const dragPointerIdRef = useRef<number | null>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const dragStartedRef = useRef(false);
  const slot = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("slot") ?? "";
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const body = document.body;
    const previousRootBackground = root.style.background;
    const previousBodyBackground = body.style.background;

    root.classList.add("is-pinned-todo-window");
    body.classList.add("is-pinned-todo-window");
    root.style.background = "transparent";
    body.style.background = "transparent";

    return () => {
      root.classList.remove("is-pinned-todo-window");
      body.classList.remove("is-pinned-todo-window");
      root.style.background = previousRootBackground;
      body.style.background = previousBodyBackground;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    void (async () => {
      const [{ invoke }, { listen }] = await Promise.all([
        import("@tauri-apps/api/core"),
        import("@tauri-apps/api/event"),
      ]);

      const activeTodo =
        slot === ""
          ? null
          : parsePinnedTodoPayload(
              await invoke<string | null>("get_active_pinned_todo", { slot }),
            );
      if (!cancelled) setTodo(activeTodo);

      unlisten = await listen<string>(pinnedTodoEventForSlot(slot), (event) => {
        const nextTodo = parsePinnedTodoPayload(event.payload);
        if (nextTodo != null) setTodo(nextTodo);
      });

      if (cancelled) unlisten();
    })();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [slot]);

  useEffect(() => {
    const refreshPinnedTodo = () => {
      if (todo == null) return;
      const loaded = loadAppData(localStorage);
      const nextTodo = loaded.data.todos.find((item) => item.id === todo.id);
      if (nextTodo == null) {
        setTodo(null);
        if (slot !== "") void removePinnedTodo(slot);
        return;
      }

      setTodo(buildPinnedTodoPayload(nextTodo));
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== APP_DATA_STORAGE_KEY) return;
      refreshPinnedTodo();
    };

    const handleAppDataUpdated = () => {
      refreshPinnedTodo();
    };

    window.addEventListener("storage", handleStorage);
    window.addEventListener("dotime-app-data-updated", handleAppDataUpdated);
    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("dotime-app-data-updated", handleAppDataUpdated);
    };
  }, [slot, todo?.id]);

  useEffect(() => {
    if (
      !todo?.isTiming &&
      !todo?.countdownEnabled &&
      !todo?.recordTimeEnabled &&
      !todo?.actualDurationSeconds
    ) {
      return;
    }

    const intervalId = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(intervalId);
  }, [
    todo?.isTiming,
    todo?.countdownEnabled,
    todo?.recordTimeEnabled,
    todo?.actualDurationSeconds,
  ]);

  useEffect(() => {
    return () => {
      if (collapseTimerRef.current != null) {
        window.clearTimeout(collapseTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    return () => {
      dragPointerIdRef.current = null;
      dragStartRef.current = null;
      dragStartedRef.current = false;
    };
  }, []);

  const handleMouseEnter = () => {
    hoverLockUntilRef.current = Date.now() + 260;
    if (collapseTimerRef.current != null) {
      window.clearTimeout(collapseTimerRef.current);
      collapseTimerRef.current = null;
    }
    setExpanded(true);
  };

  const handleMouseLeave = () => {
    if (collapseTimerRef.current != null) {
      window.clearTimeout(collapseTimerRef.current);
    }
    const delay = Math.max(120, hoverLockUntilRef.current - Date.now() + 80);
    collapseTimerRef.current = window.setTimeout(() => {
      if (shellRef.current?.matches(":hover")) {
        collapseTimerRef.current = null;
        return;
      }
      setExpanded(false);
      collapseTimerRef.current = null;
    }, delay);
  };

  const beginDrag = () => {
    if (dragStartedRef.current) return;
    dragStartedRef.current = true;
    void (async () => {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().startDragging();
    })();
  };

  const handlePointerDown = (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || event.detail > 1) return;
    dragPointerIdRef.current = event.pointerId;
    dragStartRef.current = { x: event.clientX, y: event.clientY };
    dragStartedRef.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: PointerEvent<HTMLElement>) => {
    if (dragPointerIdRef.current !== event.pointerId || dragStartedRef.current) {
      return;
    }

    const start = dragStartRef.current;
    if (start == null) return;

    const deltaX = Math.abs(event.clientX - start.x);
    const deltaY = Math.abs(event.clientY - start.y);
    if (deltaX >= 6 || deltaY >= 6) {
      beginDrag();
    }
  };

  const clearPointerDragState = (event: PointerEvent<HTMLElement>) => {
    if (dragPointerIdRef.current !== event.pointerId) return;
    dragPointerIdRef.current = null;
    dragStartRef.current = null;
    dragStartedRef.current = false;
  };

  const handleDoubleClickCapture = (event: MouseEvent<HTMLElement>) => {
    event.stopPropagation();
    handleUnpin();
  };

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        if (!cancelled) {
          await syncPinnedTodoWindowFrame(expanded);
        }
      } catch (error) {
        console.error("failed to sync pinned todo window frame", error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [expanded]);

  useGSAP(
    () => {
      if (shellRef.current == null) return;

      gsap.to(shellRef.current, {
        height: expanded
          ? PINNED_TODO_EXPANDED_HEIGHT
          : PINNED_TODO_COLLAPSED_HEIGHT,
        duration: 0.2,
        ease: "power2.out",
        overwrite: "auto",
      });
    },
    { dependencies: [expanded, todo?.id], scope: shellRef },
  );

  const liveElapsed = todo == null ? 0 : getLiveElapsed(todo, now);
  const countdownEnabled = Boolean(todo?.countdownEnabled && todo.plannedSeconds > 0);
  const progress = useMemo(() => {
    if (todo == null || !countdownEnabled) return 0;
    return Math.max(0, Math.min(100, (liveElapsed / todo.plannedSeconds) * 100));
  }, [countdownEnabled, liveElapsed, todo]);

  const handleToggleTodo = () => {
    if (todo == null) return;

    try {
      const nextTodo = togglePinnedTodoCompletion(todo.id);
      if (nextTodo != null) {
        setTodo(buildPinnedTodoPayload(nextTodo));
        if (nextTodo.completed) {
          void removePinnedTodo(slot);
        }
      }
    } catch (error) {
      console.error("failed to toggle pinned todo", error);
    }
  };

  const handleUnpin = () => {
    if (slot !== "") void removePinnedTodo(slot);
  };

  if (todo == null) {
    return (
      <main
        className={`pinned-todo-window ${
          expanded ? "is-expanded" : "is-collapsed"
        }`}
      >
        <div
          ref={shellRef}
          className="pinned-todo-window__shell"
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
        <section
          className="pinned-todo-card is-empty"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={clearPointerDragState}
          onPointerCancel={clearPointerDragState}
          onDoubleClickCapture={handleDoubleClickCapture}
          title="鼠标移入展开，双击取消固定"
        >
            <p>暂无固定待办</p>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main
      className={`pinned-todo-window ${
        expanded ? "is-expanded" : "is-collapsed"
      }`}
    >
      <div
        ref={shellRef}
        className="pinned-todo-window__shell"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <section
          className={`pinned-todo-card ${todo.completed ? "is-completed" : ""}`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={clearPointerDragState}
          onPointerCancel={clearPointerDragState}
          onDoubleClickCapture={handleDoubleClickCapture}
          title="鼠标移入展开，双击取消固定"
        >
          <button
            type="button"
            className={`check-btn pinned-todo-card__check ${
              todo.completed ? "is-checked" : ""
            }`}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              handleToggleTodo();
            }}
            onDoubleClick={(event) => event.stopPropagation()}
            aria-label={todo.completed ? "标记未完成" : "标记完成"}
            title={todo.completed ? "标记未完成" : "标记完成"}
          >
            {todo.completed ? <IconCheck size={11} /> : null}
          </button>

          <div className="pinned-todo-card__body">
            <div className="pinned-todo-card__title-row">
              <h1>{todo.title}</h1>
              <span className={`badge badge--${todo.urgency}`}>
                {URGENCY_LABELS[todo.urgency]}
              </span>
              <span
                className={`status-badge status-badge--${
                  todo.completed ? "done" : todo.isTiming ? "active" : "idle"
                }`}
              >
                {todo.completed ? "已完成" : todo.isTiming ? "进行中" : "待开始"}
              </span>
            </div>

            <div className="pinned-todo-card__meta">
              <span className="meta-item pinned-todo-card__meta-item">
                <IconClock size={13} />
                {formatDisplayDate(todo.date)}
              </span>
              {countdownEnabled && (
                <span className="meta-item pinned-todo-card__meta-item">
                  <IconClock size={13} />
                  计划 {formatDuration(todo.plannedSeconds)}
                </span>
              )}
              {todo.recordTimeEnabled && (
                <span className="meta-item meta-elapsed pinned-todo-card__meta-item">
                  <IconClockHour4 size={13} />
                  已用 {formatDuration(liveElapsed)}
                </span>
              )}
              {todo.actualDurationSeconds != null && !todo.isTiming && (
                <span className="meta-item meta-done pinned-todo-card__meta-item">
                  <IconCheck size={13} />
                  完成耗时 {formatDuration(todo.actualDurationSeconds)}
                </span>
              )}
              {todo.reminderEnabled && todo.reminderTime && (
                <span className="meta-item meta-reminder pinned-todo-card__meta-item">
                  <IconBell size={13} />
                  提醒 {todo.reminderTime}
                </span>
              )}
              {todo.subtaskTotal > 0 && (
                <span className="meta-item pinned-todo-card__meta-item">
                  <IconListCheck size={13} />
                  子待办 {todo.subtaskDone}/{todo.subtaskTotal}
                </span>
              )}
            </div>

            {countdownEnabled && (todo.isTiming || liveElapsed > 0) && (
              <div className="pinned-todo-card__progress" aria-hidden>
                <div
                  className="pinned-todo-card__progress-fill"
                  style={{ width: `${progress}%` }}
                />
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
