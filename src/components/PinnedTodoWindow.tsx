import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
} from "react";
import gsap from "gsap";
import {
  APP_DATA_STORAGE_KEY,
  createAppDataDocument,
  loadAppData,
  saveAppData,
} from "../data/appData";
import {
  pauseTodoTiming,
  startTodoTiming,
  stopTodoTimingWithRecurrence,
  toggleTodoCompletionWithRecurrence,
} from "../domain/todoState";
import { emitAppDataUpdated } from "../utils/appDataEvents";
import { URGENCY_LABELS, type Todo } from "../types";
import {
  buildPinnedTodoPayload,
  parsePinnedTodoPayload,
  pinnedTodoEventForSlot,
  pinnedSubtasksExpandedEventForSlot,
  type PinnedTodoPayload,
} from "../utils/pinnedTodo";
import { formatDuration } from "../utils/time";
import {
  IconBell,
  IconCheck,
  IconClock,
  IconClockHour4,
  IconFlame,
  IconListCheck,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlayerStop,
  IconTrash,
} from "./icons";

const PINNED_TODO_COLLAPSED_WIDTH = 210;
const PINNED_TODO_EXPANDED_WIDTH = 420;
const PINNED_TODO_COLLAPSED_HEIGHT = 46;
const PINNED_TODO_EXPANDED_HEIGHT = 60;

const pinnedTodoFrameTokens = new Map<string, number>();

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

async function bringPinnedStackToFront(slot: string) {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("bring_pinned_stack_to_front", { slot });
}

type PinnedTodoFrameTarget = {
  x: number;
  y: number;
  width: number;
  height: number;
  startX: number;
  startY: number;
  startWidth: number;
  startHeight: number;
};

async function getPinnedTodoFrameTarget(
  expanded: boolean,
): Promise<PinnedTodoFrameTarget> {
  const { currentMonitor, getCurrentWindow } = await import(
    "@tauri-apps/api/window"
  );

  const window = getCurrentWindow();
  const targetWidth = expanded
    ? PINNED_TODO_EXPANDED_WIDTH
    : PINNED_TODO_COLLAPSED_WIDTH;
  const targetHeight = expanded
    ? PINNED_TODO_EXPANDED_HEIGHT
    : PINNED_TODO_COLLAPSED_HEIGHT;

  const monitor = await currentMonitor();
  const scale = monitor?.scaleFactor ?? 1;
  const startSize = (await window.outerSize()).toLogical(scale);
  const startPos = (await window.outerPosition()).toLogical(scale);

  let targetX = startPos.x;
  let targetY = startPos.y;
  if (monitor != null) {
    const workPosition = monitor.workArea.position.toLogical(scale);
    const workSize = monitor.workArea.size.toLogical(scale);
    const currentRight = startPos.x + startSize.width;
    const maxRight = workPosition.x + workSize.width;
    const right = Math.min(
      Math.max(currentRight, workPosition.x + targetWidth),
      maxRight,
    );
    targetX = right - targetWidth;
    targetY = startPos.y;
  }

  return {
    x: targetX,
    y: targetY,
    width: targetWidth,
    height: targetHeight,
    startX: startPos.x,
    startY: startPos.y,
    startWidth: startSize.width,
    startHeight: startSize.height,
  };
}

async function snapPinnedTodoWindowFrame(
  slot: string,
  expanded: boolean,
  frame?: PinnedTodoFrameTarget,
) {
  const token = (pinnedTodoFrameTokens.get(slot) ?? 0) + 1;
  pinnedTodoFrameTokens.set(slot, token);

  const target = frame ?? (await getPinnedTodoFrameTarget(expanded));
  if (token !== pinnedTodoFrameTokens.get(slot)) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("set_pinned_window_frame", {
    x: target.x,
    y: target.y,
    width: target.width,
    height: target.height,
  });
}

async function getPinnedTodoCurrentFrame() {
  const { currentMonitor, getCurrentWindow } = await import(
    "@tauri-apps/api/window"
  );
  const window = getCurrentWindow();
  const monitor = await currentMonitor();
  const scale = monitor?.scaleFactor ?? 1;
  const size = (await window.outerSize()).toLogical(scale);
  const position = (await window.outerPosition()).toLogical(scale);
  return {
    x: position.x,
    y: position.y,
    width: size.width,
    height: size.height,
  };
}

async function debugFrameLog(label: string, payload: string) {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("debug_log", { message: `${label} ${payload}` });
  } catch {
    /* browser */
  }
}

function emitPinnedSubtasksExpanded(slot: string, expanded: boolean) {
  void (async () => {
    try {
      const { emit } = await import("@tauri-apps/api/event");
      await emit(pinnedSubtasksExpandedEventForSlot(slot), { expanded });
    } catch (error) {
      console.error("failed to emit pinned subtasks expanded state", error);
    }
  })();
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

function updatePinnedTodoData(
  todoId: string,
  updater: (todo: Todo) => Todo,
): Todo | null {
  const result = loadAppData(localStorage);
  let updated: Todo | null = null;
  const nextTodos = result.data.todos.map((todo) => {
    if (todo.id !== todoId) return todo;
    updated = updater(todo);
    return updated;
  });
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
  return updated;
}

function deletePinnedTodoData(todoId: string) {
  const result = loadAppData(localStorage);
  const nextTodos = result.data.todos.filter((todo) => todo.id !== todoId);
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
}

export function PinnedTodoWindow() {
  const [todo, setTodo] = useState<PinnedTodoPayload | null>(null);
  const [now, setNow] = useState(Date.now());
  const [expanded, setExpanded] = useState(false);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const collapseTimerRef = useRef<number | null>(null);
  const hoverLockUntilRef = useRef(0);
  const hoveredRef = useRef(false);
  const collapseCooldownUntilRef = useRef(0);
  const pendingExpandOnMoveRef = useRef(false);
  const frameTokenRef = useRef(0);
  const frameTweenRef = useRef<ReturnType<typeof gsap.to> | null>(null);
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
    hoveredRef.current = true;
    hoverLockUntilRef.current = Date.now() + 260;
    if (collapseTimerRef.current != null) {
      window.clearTimeout(collapseTimerRef.current);
      collapseTimerRef.current = null;
    }
    // 收起后窗口移动会让鼠标“被动进入”窗口；这种进入先不展开，
    // 等鼠标在窗口内真正移动时再展开，避免反复收起/展开。
    if (Date.now() < collapseCooldownUntilRef.current) {
      pendingExpandOnMoveRef.current = true;
      return;
    }
    setExpanded(true);
    emitPinnedSubtasksExpanded(slot, true);
  };

  const handleMouseLeave = () => {
    hoveredRef.current = false;
    pendingExpandOnMoveRef.current = false;
    if (collapseTimerRef.current != null) {
      window.clearTimeout(collapseTimerRef.current);
    }
    const delay = Math.max(400, hoverLockUntilRef.current - Date.now() + 80);
    collapseTimerRef.current = window.setTimeout(() => {
      if (shellRef.current?.matches(":hover")) {
        collapseTimerRef.current = null;
        return;
      }
      collapseCooldownUntilRef.current = Date.now() + 700;
      setExpanded(false);
      emitPinnedSubtasksExpanded(slot, false);
      collapseTimerRef.current = null;
    }, delay);
  };

  const handleShellPointerMove = () => {
    if (pendingExpandOnMoveRef.current && hoveredRef.current) {
      pendingExpandOnMoveRef.current = false;
      setExpanded(true);
      emitPinnedSubtasksExpanded(slot, true);
    }
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
    const shell = shellRef.current;
    if (shell == null || todo == null) return;

    const token = ++frameTokenRef.current;
    frameTweenRef.current?.kill();
    let disposed = false;

    void (async () => {
      let frame: PinnedTodoFrameTarget | null = null;
      try {
        frame = await getPinnedTodoFrameTarget(expanded);
        if (disposed || token !== frameTokenRef.current) return;
      } catch (error) {
        console.error("failed to measure pinned todo target", error);
      }

      let start: { x: number; y: number; width: number; height: number };
      try {
        start = frame
          ? {
              x: frame.startX,
              y: frame.startY,
              width: frame.startWidth,
              height: frame.startHeight,
            }
          : await getPinnedTodoCurrentFrame();
      } catch (error) {
        console.error("failed to measure pinned todo current frame", error);
        return;
      }

      const end = frame
        ? {
            x: frame.x,
            y: frame.y,
            width: frame.width,
            height: frame.height,
          }
        : {
            ...start,
            width: expanded
              ? PINNED_TODO_EXPANDED_WIDTH
              : PINNED_TODO_COLLAPSED_WIDTH,
            height: expanded
              ? PINNED_TODO_EXPANDED_HEIGHT
              : PINNED_TODO_COLLAPSED_HEIGHT,
          };

      void debugFrameLog(
        "[todo-frame]",
        `slot=${slot} expanded=${expanded} start=${start.x.toFixed(1)},${start.width.toFixed(1)} right=${(start.x + start.width).toFixed(1)} end=${end.x.toFixed(1)},${end.width.toFixed(1)} endRight=${(end.x + end.width).toFixed(1)}`,
      );

      if (expanded) {
        void bringPinnedStackToFront(slot).catch((error) => {
          console.error("failed to bring pinned stack to front", error);
        });
      }

      // 让窗口跟随内容：直接动画 shell 的尺寸，再把原生窗口同步到 shell 的
      // 实际大小，避免透明窗口在快速缩放时 WebView 重绘滞后露出右侧空隙。
      gsap.killTweensOf(shell);
      gsap.set(shell, { width: start.width, height: start.height });

      const setNativeFrame = (
        x: number,
        y: number,
        width: number,
        height: number,
      ) => {
        void (async () => {
          try {
            const { invoke } = await import("@tauri-apps/api/core");
            await invoke("set_pinned_window_frame", {
              x,
              y,
              width,
              height,
            });
          } catch (error) {
            console.error("failed to set pinned todo window frame", error);
          }
        })();
      };

      // 窗口一次性跳到目标框架（透明区域不可见），内容在固定窗口内平滑生长
      void setNativeFrame(end.x, end.y, end.width, end.height);

      frameTweenRef.current = gsap.to(shell, {
        width: end.width,
        height: end.height,
        duration: expanded ? 0.28 : 0.18,
        ease: expanded ? "power2.out" : "power2.inOut",
        onComplete: () => {
          if (disposed || token !== frameTokenRef.current) return;
          gsap.set(shell, { clearProps: "width,height" });
          if (!expanded) {
            void setNativeFrame(end.x, end.y, end.width, end.height);
          } else {
            void snapPinnedTodoWindowFrame(
              slot,
              expanded,
              frame ?? undefined,
            );
          }
        },
      });
    })();

    return () => {
      disposed = true;
      frameTweenRef.current?.kill();
    };
  }, [expanded, slot, todo?.id]);

  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | undefined;

    void import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen<{ expanded: boolean }>(
          pinnedSubtasksExpandedEventForSlot(slot),
          (event) => {
            if (cancelled) return;
            const nextExpanded = Boolean(event.payload?.expanded);
            if (nextExpanded) {
              if (collapseTimerRef.current != null) {
                window.clearTimeout(collapseTimerRef.current);
                collapseTimerRef.current = null;
              }
              setExpanded(true);
              return;
            }
            if (shellRef.current?.matches(":hover")) return;
            collapseCooldownUntilRef.current = Date.now() + 700;
            setExpanded(false);
          },
        ),
      )
      .then((unlisten) => {
        if (cancelled) unlisten();
        else cleanup = unlisten;
      })
      .catch(() => {
        cleanup = undefined;
      });

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [slot]);

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

  const handleStartTiming = () => {
    if (todo == null) return;
    try {
      const updated = updatePinnedTodoData(todo.id, (item) =>
        startTodoTiming([item], item.id, Date.now())[0],
      );
      if (updated != null) setTodo(buildPinnedTodoPayload(updated));
    } catch (error) {
      console.error("failed to start pinned todo timing", error);
    }
  };

  const handlePauseTiming = () => {
    if (todo == null) return;
    try {
      const updated = updatePinnedTodoData(todo.id, (item) =>
        pauseTodoTiming([item], item.id, Date.now())[0],
      );
      if (updated != null) setTodo(buildPinnedTodoPayload(updated));
    } catch (error) {
      console.error("failed to pause pinned todo timing", error);
    }
  };

  const handleStopTiming = () => {
    if (todo == null) return;
    try {
      const updated = updatePinnedTodoData(todo.id, (item) =>
        stopTodoTimingWithRecurrence([item], item.id, Date.now())[0],
      );
      if (updated != null) {
        setTodo(buildPinnedTodoPayload(updated));
        if (updated.completed && slot !== "") {
          void removePinnedTodo(slot);
        }
      }
    } catch (error) {
      console.error("failed to stop pinned todo timing", error);
    }
  };

  const handleDeleteTodo = () => {
    if (todo == null) return;
    try {
      deletePinnedTodoData(todo.id);
      if (slot !== "") void removePinnedTodo(slot);
    } catch (error) {
      console.error("failed to delete pinned todo", error);
    }
  };

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
        onPointerMove={handleShellPointerMove}
      >
        <section
          className={`pinned-todo-card ${todo?.completed ? "is-completed" : ""}`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={clearPointerDragState}
          onPointerCancel={clearPointerDragState}
          onDoubleClickCapture={handleDoubleClickCapture}
          title="鼠标移入展开，双击取消固定"
        >
          {todo != null && (
            <>
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
                  <span
                    className={`urgency-icon urgency-icon--${todo.urgency}`}
                    title={`紧急程度：${URGENCY_LABELS[todo.urgency]}`}
                    aria-label={`紧急程度：${URGENCY_LABELS[todo.urgency]}`}
                  >
                    <IconFlame size={13} />
                  </span>
                  <span
                    className={`status-badge status-badge--${
                      todo.completed
                        ? "done"
                        : todo.isTiming
                          ? "active"
                          : "idle"
                    }`}
                  >
                    {todo.completed
                      ? "已完成"
                      : todo.isTiming
                        ? "进行中"
                        : "待开始"}
                  </span>
                </div>

                <div className="pinned-todo-card__meta">
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
                  {expanded && (
                    <span className="pinned-todo-card__actions">
                      {(todo.countdownEnabled || todo.recordTimeEnabled) &&
                        (todo.isTiming ? (
                          <>
                            <button
                              type="button"
                              className="pinned-card-action pinned-card-action--sm"
                              onPointerDown={(event) =>
                                event.stopPropagation()
                              }
                              onDoubleClick={(event) =>
                                event.stopPropagation()
                              }
                              onClick={handlePauseTiming}
                              aria-label="暂停计时"
                              title="暂停计时"
                            >
                              <IconPlayerPause size={13} />
                            </button>
                            <button
                              type="button"
                              className="pinned-card-action pinned-card-action--sm"
                              onPointerDown={(event) =>
                                event.stopPropagation()
                              }
                              onDoubleClick={(event) =>
                                event.stopPropagation()
                              }
                              onClick={handleStopTiming}
                              aria-label="结束计时"
                              title="结束计时"
                            >
                              <IconPlayerStop size={13} />
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="pinned-card-action pinned-card-action--sm"
                            onPointerDown={(event) => event.stopPropagation()}
                            onDoubleClick={(event) => event.stopPropagation()}
                            onClick={handleStartTiming}
                            aria-label="开始计时"
                            title="开始计时"
                          >
                            <IconPlayerPlay size={13} />
                          </button>
                        ))}
                      <button
                        type="button"
                        className="pinned-card-action pinned-card-action--sm is-danger"
                        onPointerDown={(event) => event.stopPropagation()}
                        onDoubleClick={(event) => event.stopPropagation()}
                        onClick={handleDeleteTodo}
                        aria-label="删除待办"
                        title="删除待办"
                      >
                        <IconTrash size={13} />
                      </button>
                    </span>
                  )}
                </div>

                {countdownEnabled && liveElapsed > 0 && (
                  <div className="pinned-todo-card__progress" aria-hidden>
                    <div
                      className="pinned-todo-card__progress-fill"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
