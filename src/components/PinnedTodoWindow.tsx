import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
} from "react";
import { usePinnedWindowFrame } from "../hooks/usePinnedWindowFrame";
import type { PinnedWindowFrame } from "../utils/pinnedWindowFrame";
import { measurePinnedWindowLayout } from "../utils/pinnedWindowLayout";
import { usePinnedLayoutRevision } from "../hooks/usePinnedLayoutRevision";
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
import { mirrorAppDataStorage } from "../data/fileStorage";
import { URGENCY_LABELS, type Todo } from "../types";
import {
  buildPinnedTodoPayload,
  parsePinnedTodoPayload,
  pinnedTodoEventForSlot,
  pinnedSubtasksExpandedEventForSlot,
  pinnedSubtasksStateRequestEventForSlot,
  type PinnedTodoPayload,
} from "../utils/pinnedTodo";
import { formatDuration } from "../utils/time";
import { useWindowOpacity } from "../utils/windowOpacity";
import {
  IconBell,
  IconCheck,
  IconClock,
  IconClockHour4,
  IconFlame,
  IconListCheck,
  IconPin,
  IconPinOff,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlayerStop,
  IconTrash,
} from "./icons";

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

async function setPinnedSubtasksMoving(slot: string, moving: boolean) {
  if (slot === "") return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("sync_pinned_subtasks_window_with_parent", { slot, moving });
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
  mirrorAppDataStorage();

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
  mirrorAppDataStorage();
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
  mirrorAppDataStorage();
  void emitAppDataUpdated().catch((error) => {
    console.error("failed to emit app data update", error);
  });
}

export function PinnedTodoWindow() {
  const [todo, setTodo] = useState<PinnedTodoPayload | null>(null);
  const [presentation, setPresentation] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [expanded, setExpanded] = useState(false);
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;
  const [alwaysOnTop, setAlwaysOnTop] = useState(true);
  const [topmostBusy, setTopmostBusy] = useState(false);
  const shellRef = useRef<HTMLDivElement | null>(null);
  useWindowOpacity(shellRef);
  const collapseTimerRef = useRef<number | null>(null);
  const hoverLockUntilRef = useRef(0);
  const hoveredRef = useRef(false);
  const collapseCooldownUntilRef = useRef(0);
  const pendingExpandOnMoveRef = useRef(false);
  const dragPointerIdRef = useRef<number | null>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const dragStartedRef = useRef(false);
  const dragMovementCleanupRef = useRef<(() => void) | null>(null);
  const dragMovementFinishRef = useRef<(() => Promise<void>) | null>(null);
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

      let receivedUpdate = false;
      unlisten = await listen<string>(pinnedTodoEventForSlot(slot), (event) => {
        if (cancelled) return;
        receivedUpdate = true;
        const nextTodo = parsePinnedTodoPayload(event.payload);
        setTodo(nextTodo);
        setPresentation((value) => value + 1);
        setExpanded(false);
        pendingExpandOnMoveRef.current = false;
        collapseCooldownUntilRef.current = 0;
        if (collapseTimerRef.current != null) {
          window.clearTimeout(collapseTimerRef.current);
          collapseTimerRef.current = null;
        }
      });

      if (cancelled) { unlisten(); return; }
      const activeTodo =
        slot === ""
          ? null
          : parsePinnedTodoPayload(
              await invoke<string | null>("get_active_pinned_todo", { slot }),
            );
      if (!cancelled && !receivedUpdate) setTodo(activeTodo);

      if (cancelled) unlisten();
    })();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [slot]);

  useEffect(() => {
    if (todo == null || slot === "") return;
    let cancelled = false;
    void import("@tauri-apps/api/core")
      .then(({ invoke }) =>
        invoke<boolean>("get_pinned_stack_always_on_top", { slot }),
      )
      .then((nextAlwaysOnTop) => {
        if (!cancelled) setAlwaysOnTop(nextAlwaysOnTop);
      })
      .catch((error) => {
        console.error("failed to read pinned window topmost state", error);
      });
    return () => {
      cancelled = true;
    };
  }, [slot, todo?.id]);

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
      dragMovementCleanupRef.current?.();
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
      try {
        const [{ invoke }, { getCurrentWindow, monitorFromPoint }] = await Promise.all([
          import("@tauri-apps/api/core"),
          import("@tauri-apps/api/window"),
        ]);
        await setPinnedSubtasksMoving(slot, true);
        if (dragPointerIdRef.current == null || !dragStartedRef.current) {
          await setPinnedSubtasksMoving(slot, false);
          return;
        }
        const parentWindow = getCurrentWindow();
        const childCount = todo?.subtaskTotal ?? 0;
        const childSize = childCount > 0
          ? await invoke<PinnedWindowFrame | null>("get_pinned_subtasks_visible_frame", { slot })
          : null;
        const parentBounds = shellRef.current?.getBoundingClientRect();
        let latestPosition: { x: number; y: number } | null = null;
        let frameRequest = 0;
        let syncVersion = 0;
        const moveChildAlongside = async (position: { x: number; y: number }) => {
          if (childSize == null) return;
          const version = ++syncVersion;
          const monitor = await monitorFromPoint(position.x, position.y);
          const scale = monitor?.scaleFactor ?? await parentWindow.scaleFactor();
          const parentSize = parentBounds ?? { width: 210, height: 46, x: 0, y: 0 };
          const parentX = position.x + parentSize.x * scale;
          const parentY = position.y + parentSize.y * scale;
          const childWidth = childSize.width * scale;
          const childHeight = childSize.height * scale;
          const gap = 4 * scale;
          const workArea = monitor?.workArea;
          let x = parentX + parentSize.width * scale - childWidth;
          let y = parentY + parentSize.height * scale + gap;
          if (workArea != null) {
            const minX = workArea.position.x + gap;
            const maxX = workArea.position.x + workArea.size.width - childWidth - gap;
            const minY = workArea.position.y + gap;
            const maxY = workArea.position.y + workArea.size.height - childHeight - gap;
            x = Math.min(Math.max(x, minX), Math.max(minX, maxX));
            if (y + childHeight > maxY) y = parentY - childHeight - gap;
            y = Math.min(Math.max(y, minY), Math.max(minY, maxY));
          }
          if (version !== syncVersion) return;
          await invoke("move_pinned_subtasks_window_with_parent", { slot, x, y });
        };
        const unlistenMoved = await parentWindow.onMoved(({ payload }) => {
          latestPosition = payload;
          if (frameRequest !== 0) return;
          frameRequest = window.requestAnimationFrame(() => {
            frameRequest = 0;
            if (latestPosition != null) {
              void moveChildAlongside(latestPosition).catch((error) => {
                console.error("failed to move pinned subtasks with parent", error);
              });
            }
          });
        });
        dragMovementCleanupRef.current = () => {
          unlistenMoved();
          if (frameRequest !== 0) window.cancelAnimationFrame(frameRequest);
        };
        dragMovementFinishRef.current = async () => {
          try {
            dragMovementCleanupRef.current?.();
            dragMovementCleanupRef.current = null;
            const position = await parentWindow.outerPosition();
            await moveChildAlongside(position);
          } finally {
            await setPinnedSubtasksMoving(slot, false);
          }
        };
        if (dragPointerIdRef.current == null || !dragStartedRef.current) {
          const finishMovement = dragMovementFinishRef.current;
          dragMovementFinishRef.current = null;
          await finishMovement?.();
          return;
        }
        await parentWindow.startDragging();
      } catch (error) {
        dragStartedRef.current = false;
        dragMovementCleanupRef.current?.();
        dragMovementCleanupRef.current = null;
        dragMovementFinishRef.current = null;
        void setPinnedSubtasksMoving(slot, false).catch(() => {});
        console.error("failed to start dragging pinned todo", error);
      }
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
    if (dragStartedRef.current) {
      const finishMovement = dragMovementFinishRef.current;
      dragMovementFinishRef.current = null;
      void (finishMovement?.() ?? setPinnedSubtasksMoving(slot, false)).catch((error) => {
        console.error("failed to finish pinned todo movement", error);
      });
    }
    dragPointerIdRef.current = null;
    dragStartRef.current = null;
    dragStartedRef.current = false;
  };

  const handleDoubleClickCapture = (event: MouseEvent<HTMLElement>) => {
    event.stopPropagation();
    if (event.target instanceof Element && event.target.closest("button")) {
      return;
    }
    handleUnpin();
  };

  const layoutRevision = usePinnedLayoutRevision();
  const measureFrame = useCallback(() => measurePinnedWindowLayout("parent", {
    slot, todoId: todo?.id, expanded, subtaskTotal: todo?.subtaskTotal ?? 0,
  }), [slot, todo?.id, todo?.subtaskTotal, expanded, layoutRevision]);
  const notifyReady = useCallback(async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("pinned_todo_window_ready", { slot, todoId: todo?.id });
  }, [slot, todo?.id]);
  usePinnedWindowFrame({
    shellRef, identity: todo ? `${todo.id}:${presentation}` : undefined,
    expanded, measure: measureFrame, onReady: notifyReady,
  });

  useEffect(() => {
    if (expanded) void bringPinnedStackToFront(slot).catch(console.error);
  }, [expanded, slot]);

  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | undefined;
    void import("@tauri-apps/api/event").then(async ({ listen }) => {
      const unlisten = await listen(pinnedSubtasksStateRequestEventForSlot(slot), () => {
        if (!cancelled) emitPinnedSubtasksExpanded(slot, expandedRef.current);
      });
      if (cancelled) unlisten();
      else cleanup = unlisten;
    }).catch(console.error);
    return () => { cancelled = true; cleanup?.(); };
  }, [slot]);

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
  const countdownEnabled = Boolean(
    todo?.countdownEnabled && todo.plannedSeconds > 0,
  );
  const countdownOnlyEnabled = Boolean(
    todo?.countdownOnlyEnabled && countdownEnabled,
  );
  const remaining =
    todo == null ? 0 : Math.max(0, todo.plannedSeconds - liveElapsed);
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

  const handleToggleAlwaysOnTop = async () => {
    if (slot === "" || topmostBusy) return;
    const nextAlwaysOnTop = !alwaysOnTop;
    setTopmostBusy(true);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("set_pinned_stack_always_on_top", {
        slot,
        alwaysOnTop: nextAlwaysOnTop,
      });
      setAlwaysOnTop(nextAlwaysOnTop);
    } catch (error) {
      console.error("failed to update pinned window topmost state", error);
    } finally {
      setTopmostBusy(false);
    }
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
                  <button
                    type="button"
                    className={`pinned-card-action pinned-card-action--sm pinned-todo-card__topmost-toggle ${
                      alwaysOnTop ? "is-active" : ""
                    }`}
                    onPointerDown={(event) => event.stopPropagation()}
                    onDoubleClick={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      void handleToggleAlwaysOnTop();
                    }}
                    disabled={topmostBusy}
                    aria-pressed={alwaysOnTop}
                    aria-label={alwaysOnTop ? "取消窗口置顶" : "置顶窗口"}
                    title={alwaysOnTop ? "取消置顶" : "置顶"}
                  >
                    {alwaysOnTop ? (
                      <IconPin size={13} />
                    ) : (
                      <IconPinOff size={13} />
                    )}
                  </button>
                </div>

                <div className="pinned-todo-card__meta" inert={!expanded} aria-hidden={!expanded}>
                  {countdownEnabled && (
                    <span
                      className={`meta-item pinned-todo-card__meta-item ${
                        countdownOnlyEnabled ? "meta-countdown-remaining" : ""
                      }`}
                    >
                      <IconClock size={13} />
                      {countdownOnlyEnabled
                        ? `剩余 ${formatDuration(remaining)}`
                        : `计划 ${formatDuration(todo.plannedSeconds)}`}
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
                        ) : !countdownOnlyEnabled ? (
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
                        ) : null)}
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
