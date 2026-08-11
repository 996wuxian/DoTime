import { useEffect, useRef, useState } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { createAppDataDocument, loadAppData, saveAppData } from "../data/appData";
import { buildMiniSubtasksGroup } from "../utils/miniSubtasks";
import {
  MINI_SUBTASKS_GROUP_EVENT,
  MINI_SUBTASKS_CLOSED_EVENT,
  MINI_SUBTASKS_HOVER_EVENT,
  MINI_SUBTASKS_VISIBILITY_EVENT,
  parseMiniSubtasksGroup,
  type MiniSubtaskItem,
  type MiniSubtasksGroup,
} from "../utils/miniSubtasks";
import type { Todo } from "../types";
import { URGENCY_LABELS } from "../types";
import { formatDuration, formatDurationHuman } from "../utils/time";
import {
  IconCheck,
  IconClock,
  IconClockHour4,
  IconClose,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlayerStop,
  IconTrash,
} from "./icons";
import {
  pauseTodoSubtaskTiming,
  removeTodoSubtask,
  startTodoSubtaskTiming,
  stopTodoSubtaskTiming,
  toggleTodoSubtask,
} from "../domain/todoState";

async function closeMiniSubtasksWindow() {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("close_mini_subtasks_window");
}

async function emitMiniSubtasksHover(hovered: boolean) {
  const { emit } = await import("@tauri-apps/api/event");
  await emit(MINI_SUBTASKS_HOVER_EVENT, { hovered });
}

function getLiveElapsed(item: MiniSubtaskItem, now: number) {
  if (!item.isTiming || item.timingStartedAt == null) {
    return item.actualDurationSeconds ?? item.elapsedSeconds;
  }
  return item.elapsedSeconds + Math.max(0, Math.floor((now - item.timingStartedAt) / 1000));
}

function getProgress(item: MiniSubtaskItem, liveElapsed: number) {
  if (!item.countdownEnabled || item.plannedSeconds <= 0) return null;
  const remaining = Math.max(0, item.plannedSeconds - liveElapsed);
  return Math.max(0, Math.min(100, (remaining / item.plannedSeconds) * 100));
}

async function updateMiniSubtaskTodo(
  updater: (todos: Todo[]) => Todo[],
) {
  const result = loadAppData(localStorage);
  const nextTodos = updater(result.data.todos);
  const saveResult = saveAppData(
    createAppDataDocument(nextTodos, result.data.manualSortDates, result.data.categoryDividers),
    localStorage,
  );
  if (!saveResult.ok) {
    throw new Error(saveResult.error);
  }
}

type RenderState = "entering" | "visible" | "exiting";

type RenderedMiniSubtask = {
  item: MiniSubtaskItem;
  state: RenderState;
};

const ITEM_ENTER_GAP = 0.06;
const ITEM_EXIT_GAP = 0.04;
const ITEM_ENTER_DURATION = 0.24;
const ITEM_EXIT_DURATION = 0.16;

export function MiniSubtasksWindow() {
  const [group, setGroup] = useState<MiniSubtasksGroup | null>(null);
  const [now, setNow] = useState(Date.now());
  const [renderedItems, setRenderedItems] = useState<RenderedMiniSubtask[]>([]);
  const listRef = useRef<HTMLDivElement | null>(null);
  const renderedItemsRef = useRef<RenderedMiniSubtask[]>([]);
  const pendingItemsRef = useRef<MiniSubtaskItem[] | null>(null);
  const activeTodoIdRef = useRef<string | null>(null);
  const latestGroupUpdatedAtRef = useRef(0);
  const parentVisibleRef = useRef(true);
  const hoverHeartbeatRef = useRef<number | null>(null);
  const activeTodoId = group?.todoId ?? null;

  useEffect(() => {
    renderedItemsRef.current = renderedItems;
  }, [renderedItems]);

  useEffect(() => {
    const hasLiveTiming = group?.items.some((item) => item.isTiming) ?? false;
    if (!hasLiveTiming) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [group]);

  const refreshGroupFromStorage = () => {
    if (activeTodoId == null) return;
    const result = loadAppData(localStorage);
    const nextTodo = result.data.todos.find((todo) => todo.id === activeTodoId);
    const nextGroup = nextTodo ? buildMiniSubtasksGroup(nextTodo) : null;
    setGroup(nextGroup);
    if (nextGroup == null) {
      void closeMiniSubtasksWindow();
    }
  };

  const mutateCurrentTodo = async (updater: (todos: Todo[]) => Todo[]) => {
    try {
      await updateMiniSubtaskTodo(updater);
      refreshGroupFromStorage();
    } catch (error) {
      console.error("failed to update mini subtask", error);
    }
  };

  const handleToggleItem = (itemId: string) => {
    if (activeTodoId == null) return;
    const nowTs = Date.now();
    void mutateCurrentTodo((todos) =>
      toggleTodoSubtask(todos, activeTodoId, itemId, nowTs),
    );
  };

  const handleDeleteItem = (itemId: string) => {
    if (activeTodoId == null) return;
    void mutateCurrentTodo((todos) => removeTodoSubtask(todos, activeTodoId, itemId));
  };

  const handleStartItem = (itemId: string) => {
    if (activeTodoId == null) return;
    const nowTs = Date.now();
    void mutateCurrentTodo((todos) => startTodoSubtaskTiming(todos, activeTodoId, itemId, nowTs));
  };

  const handlePauseItem = (itemId: string) => {
    if (activeTodoId == null) return;
    const nowTs = Date.now();
    void mutateCurrentTodo((todos) => pauseTodoSubtaskTiming(todos, activeTodoId, itemId, nowTs));
  };

  const handleStopItem = (itemId: string) => {
    if (activeTodoId == null) return;
    const nowTs = Date.now();
    void mutateCurrentTodo((todos) => stopTodoSubtaskTiming(todos, activeTodoId, itemId, nowTs));
  };

  const stopHoverHeartbeat = () => {
    if (hoverHeartbeatRef.current == null) return;
    window.clearInterval(hoverHeartbeatRef.current);
    hoverHeartbeatRef.current = null;
  };

  const updateHoverState = (hovered: boolean) => {
    stopHoverHeartbeat();
    void emitMiniSubtasksHover(hovered);
    if (!hovered) return;

    hoverHeartbeatRef.current = window.setInterval(() => {
      void emitMiniSubtasksHover(true);
    }, 240);
  };

  useEffect(() => {
    document.body.classList.add("is-mini-subtasks-window");
    const root = document.documentElement;
    const body = document.body;
    const previousBodyBackground = body.style.background;
    const previousBackground = root.style.background;
    root.style.background = "transparent";
    body.style.background = "transparent";

    return () => {
      document.body.classList.remove("is-mini-subtasks-window");
      body.style.background = previousBodyBackground;
      root.style.background = previousBackground;
    };
  }, []);

  useEffect(() => {
    void emitMiniSubtasksHover(false);
    return () => {
      stopHoverHeartbeat();
      void emitMiniSubtasksHover(false);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | undefined;

    void (async () => {
      const [{ invoke }, { listen }] = await Promise.all([
        import("@tauri-apps/api/core"),
        import("@tauri-apps/api/event"),
      ]);

      const activeGroup = parseMiniSubtasksGroup(
        await invoke<string | null>("get_active_mini_subtasks_group"),
      );
      if (!cancelled) setGroup(activeGroup);

      cleanup = await listen<string>(MINI_SUBTASKS_GROUP_EVENT, (event) => {
        const nextGroup = parseMiniSubtasksGroup(event.payload);
        setGroup(nextGroup);
      });
    })();

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | undefined;

    void (async () => {
      const [{ listen }, { getCurrentWindow }] = await Promise.all([
        import("@tauri-apps/api/event"),
        import("@tauri-apps/api/window"),
      ]);
      cleanup = await listen<{ visible: boolean }>(
        MINI_SUBTASKS_VISIBILITY_EVENT,
        (event) => {
          if (cancelled) return;
          const nextVisible = Boolean(event.payload?.visible);
          if (parentVisibleRef.current === nextVisible) return;
          parentVisibleRef.current = nextVisible;
          if (!nextVisible) {
            updateHoverState(false);
          }
          void getCurrentWindow().setIgnoreCursorEvents(!nextVisible);

          if (!nextVisible) {
            const current = renderedItemsRef.current.filter(
              (entry) => entry.state !== "exiting",
            );
            if (current.length === 0) return;
            pendingItemsRef.current = group?.items ?? pendingItemsRef.current;
            setRenderedItems(
              current.map((entry) => ({
                ...entry,
                state: "exiting" as const,
              })),
            );
            return;
          }

          const nextItems = pendingItemsRef.current ?? group?.items ?? [];
          pendingItemsRef.current = null;
          if (nextItems.length === 0) return;
          setRenderedItems(
            nextItems.map((item) => ({ item, state: "entering" as const })),
          );
        },
      );
    })();

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [group]);

  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | undefined;

    void (async () => {
      const [{ listen }, { getCurrentWindow }] = await Promise.all([
        import("@tauri-apps/api/event"),
        import("@tauri-apps/api/window"),
      ]);
      cleanup = await listen(MINI_SUBTASKS_CLOSED_EVENT, () => {
        if (cancelled) return;
        activeTodoIdRef.current = null;
        latestGroupUpdatedAtRef.current = 0;
        pendingItemsRef.current = null;
        updateHoverState(false);
        void getCurrentWindow().setIgnoreCursorEvents(true);
        setRenderedItems([]);
      });
    })();

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);

  useEffect(() => {
    const nextItems = group?.items ?? [];
    const nextUpdatedAt = group?.updatedAt ?? 0;
    if (nextUpdatedAt < latestGroupUpdatedAtRef.current) {
      return;
    }
    latestGroupUpdatedAtRef.current = nextUpdatedAt;
    const nextTodoId = group?.todoId ?? null;
    const current = renderedItemsRef.current;
    const activeCurrent = current.filter((entry) => entry.state !== "exiting");
    const currentSignature = activeCurrent.map((entry) => entry.item.id).join("|");
    const nextSignature = nextItems.map((item) => item.id).join("|");
    const nextById = new Map(nextItems.map((item) => [item.id, item]));

    if (!parentVisibleRef.current) {
      pendingItemsRef.current = nextItems;
      return;
    }

    if (activeTodoIdRef.current !== nextTodoId) {
      activeTodoIdRef.current = nextTodoId;
      pendingItemsRef.current = null;
      setRenderedItems(
        nextItems.map((item) => ({ item, state: "entering" as const })),
      );
      return;
    }

    if (currentSignature === nextSignature) {
      setRenderedItems(
        current.map((entry) => ({
          item: nextById.get(entry.item.id) ?? entry.item,
          state: entry.state,
        })),
      );
      return;
    }

    if (current.length === 0) {
      pendingItemsRef.current = null;
      setRenderedItems(
        nextItems.map((item) => ({ item, state: "entering" as const })),
      );
      return;
    }

    pendingItemsRef.current = nextItems;
    setRenderedItems(
      current
        .map((entry) => ({
          ...entry,
          state: "exiting" as const,
        })),
    );
  }, [group]);

  useGSAP(
    () => {
      const enteringIds = new Set(
        renderedItems
          .filter((entry) => entry.state === "entering")
          .map((entry) => entry.item.id),
      );
      const exitingIds = new Set(
        renderedItems
          .filter((entry) => entry.state === "exiting")
          .map((entry) => entry.item.id),
      );
      const visibleIds = new Set(
        renderedItems
          .filter((entry) => entry.state === "visible")
          .map((entry) => entry.item.id),
      );

      const enteringNodes = Array.from(
        listRef.current?.querySelectorAll<HTMLElement>(
          ".mini-subtasks-window__item.is-entering",
        ) ?? [],
      );
      const exitingNodes = Array.from(
        listRef.current?.querySelectorAll<HTMLElement>(
          ".mini-subtasks-window__item.is-exiting",
        ) ?? [],
      );
      const visibleNodes = Array.from(
        listRef.current?.querySelectorAll<HTMLElement>(
          ".mini-subtasks-window__item.is-visible",
        ) ?? [],
      ).filter((node) => visibleIds.has(node.dataset.itemId ?? ""));

      if (enteringNodes.length > 0) {
        const timeline = gsap.timeline({
          onComplete: () => {
            setRenderedItems((currentItems) =>
              currentItems.map((entry) =>
                enteringIds.has(entry.item.id)
                  ? { ...entry, state: "visible" }
                  : entry,
              ),
            );
          },
        });

        let cursor = 0.08;
        enteringNodes.forEach((node) => {
          timeline.fromTo(
            node,
            { autoAlpha: 0, y: 4 },
            {
              autoAlpha: 1,
              y: 0,
              duration: ITEM_ENTER_DURATION,
              ease: "power2.out",
            },
            cursor,
          );
          cursor += ITEM_ENTER_DURATION + ITEM_ENTER_GAP;
        });
      }

      if (exitingNodes.length > 0) {
        const timeline = gsap.timeline({
          onComplete: () => {
            const pendingItems = pendingItemsRef.current;
            pendingItemsRef.current = null;

            if (!parentVisibleRef.current) {
              setRenderedItems([]);
              return;
            }

            if (pendingItems != null && pendingItems.length > 0) {
              setRenderedItems(
                pendingItems.map((item) => ({
                  item,
                  state: "entering" as const,
                })),
              );
              return;
            }

            setRenderedItems((currentItems) =>
              currentItems.filter((entry) => !exitingIds.has(entry.item.id)),
            );
          },
        });

        let cursor = 0;
        exitingNodes.forEach((node) => {
          timeline.to(
            node,
            {
              autoAlpha: 0,
              y: -4,
              duration: ITEM_EXIT_DURATION,
              ease: "power1.out",
            },
            cursor,
          );
          cursor += ITEM_EXIT_DURATION + ITEM_EXIT_GAP;
        });
      }

      if (visibleNodes.length > 0) {
        gsap.set(visibleNodes, { autoAlpha: 1, y: 0 });
      }
    },
    { dependencies: [renderedItems], scope: listRef },
  );

  return (
    <main
      className="mini-subtasks-window"
      aria-label="子待办窗口"
      onMouseEnter={() => updateHoverState(true)}
      onMouseLeave={() => updateHoverState(false)}
    >
      <button
        type="button"
        className="mini-subtasks-window__close"
        onClick={() => void closeMiniSubtasksWindow()}
        aria-label="关闭子待办窗口"
        title="关闭"
      >
        <IconClose size={14} />
      </button>

      {renderedItems.length > 0 ? (
        <div ref={listRef} className="mini-subtasks-window__list" role="list">
          {renderedItems.map((entry) => {
            const { item } = entry;
            const liveElapsed = getLiveElapsed(item, now);
            const countdownEnabled =
              item.countdownEnabled && item.plannedSeconds > 0;
            const isSimpleItem = !countdownEnabled && !item.recordTimeEnabled;
            const progress = getProgress(item, liveElapsed);

            return (
              <article
                key={item.id}
                className={`mini-subtasks-window__item ${
                  item.completed ? "is-completed" : ""
                } ${countdownEnabled ? "has-countdown" : ""} ${
                  isSimpleItem ? "is-simple" : ""
                } is-${entry.state}`}
                role="listitem"
                data-item-id={item.id}
              >
                <button
                  type="button"
                  className={`check-btn mini-subtasks-window__check ${
                    item.completed ? "is-checked" : ""
                  }`}
                  onClick={() => handleToggleItem(item.id)}
                  aria-label={item.completed ? "标记未完成" : "标记完成"}
                  title={item.completed ? "标记未完成" : "标记完成"}
                >
                  {item.completed ? <IconCheck size={11} /> : null}
                </button>
                {isSimpleItem ? (
                  <>
                    <div className="mini-subtasks-window__simple-main">
                      <div className="mini-subtasks-window__title-row">
                        <span className="mini-subtasks-window__title">
                          {item.title}
                        </span>
                        <span className={`badge badge--${item.urgency}`}>
                          {URGENCY_LABELS[item.urgency]}
                        </span>
                        <span
                          className={`status-badge status-badge--${
                            item.completed
                              ? "done"
                              : item.isTiming
                                ? "active"
                                : "idle"
                          }`}
                        >
                          {item.completed
                            ? "已完成"
                            : item.isTiming
                              ? "进行中"
                              : "待开始"}
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="mini-icon-btn mini-subtasks-window__action-btn btn-delete"
                      onClick={() => handleDeleteItem(item.id)}
                      aria-label="删除子待办"
                      title="删除"
                    >
                      <IconTrash size={12} />
                    </button>
                  </>
                ) : (
                  <>
                    <div className="mini-subtasks-window__body">
                      <div className="mini-subtasks-window__title-row">
                        <span className="mini-subtasks-window__title">
                          {item.title}
                        </span>
                        <span className={`badge badge--${item.urgency}`}>
                          {URGENCY_LABELS[item.urgency]}
                        </span>
                        <span
                          className={`status-badge status-badge--${
                            item.completed
                              ? "done"
                              : item.isTiming
                                ? "active"
                                : "idle"
                          }`}
                        >
                          {item.completed
                            ? "已完成"
                            : item.isTiming
                              ? "进行中"
                              : "待开始"}
                        </span>
                      </div>
                      <div className="mini-subtasks-window__meta-row">
                        <div className="mini-subtasks-window__meta">
                          {countdownEnabled && (
                            <span className="mini-subtasks-window__meta-item">
                              <IconClock size={13} />
                              计划 {formatDuration(item.plannedSeconds)}
                            </span>
                          )}
                          {item.recordTimeEnabled && (
                            <span className="mini-subtasks-window__meta-item">
                              <IconClockHour4 size={13} />
                              已用{" "}
                              {item.isTiming || item.actualDurationSeconds == null
                                ? formatDuration(liveElapsed)
                                : formatDurationHuman(item.actualDurationSeconds)}
                            </span>
                          )}
                        </div>
                        <div className="mini-subtasks-window__actions">
                          {item.recordTimeEnabled &&
                          !item.completed &&
                          !item.isTiming ? (
                            <button
                              type="button"
                              className="mini-icon-btn mini-subtasks-window__action-btn"
                              onClick={() => handleStartItem(item.id)}
                              aria-label="开始子待办计时"
                              title="开始计时"
                            >
                              <IconPlayerPlay size={12} />
                            </button>
                          ) : null}
                          {item.isTiming ? (
                            <>
                              <button
                                type="button"
                                className="mini-icon-btn mini-subtasks-window__action-btn"
                                onClick={() => handlePauseItem(item.id)}
                                aria-label="暂停子待办计时"
                                title="暂停计时"
                              >
                                <IconPlayerPause size={12} />
                              </button>
                              <button
                                type="button"
                                className="mini-icon-btn mini-subtasks-window__action-btn"
                                onClick={() => handleStopItem(item.id)}
                                aria-label="结束子待办计时"
                                title="结束计时"
                              >
                                <IconPlayerStop size={12} />
                              </button>
                            </>
                          ) : null}
                          <button
                            type="button"
                            className="mini-icon-btn mini-subtasks-window__action-btn btn-delete"
                            onClick={() => handleDeleteItem(item.id)}
                            aria-label="删除子待办"
                            title="删除"
                          >
                            <IconTrash size={12} />
                          </button>
                        </div>
                      </div>
                    </div>
                  </>
                )}
                {countdownEnabled && (
                  <span className="mini-subtasks-window__progress" aria-hidden>
                    <span
                      className="mini-subtasks-window__progress-fill"
                      style={{ width: `${progress ?? 0}%` }}
                    />
                  </span>
                )}
              </article>
            );
          })}
        </div>
      ) : null}
    </main>
  );
}
