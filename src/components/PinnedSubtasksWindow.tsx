import { useEffect, useRef, useState } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import {
  APP_DATA_STORAGE_KEY,
  createAppDataDocument,
  loadAppData,
  saveAppData,
} from "../data/appData";
import { emitAppDataUpdated } from "../utils/appDataEvents";
import {
  parseMiniSubtasksGroup,
  type MiniSubtaskItem,
  type MiniSubtasksGroup,
} from "../utils/miniSubtasks";
import { pinnedSubtasksExpandedEventForSlot } from "../utils/pinnedTodo";
import type { Todo } from "../types";
import { URGENCY_LABELS } from "../types";
import { formatDuration, formatDurationHuman } from "../utils/time";
import {
  IconCheck,
  IconClock,
  IconClockHour4,
  IconClose,
  IconFlame,
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

async function closePinnedSubtasksWindow(slot: string) {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("close_pinned_subtasks_window", { slot });
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

function getLiveElapsed(item: MiniSubtaskItem, now: number) {
  if (!item.isTiming || item.timingStartedAt == null) {
    return item.actualDurationSeconds ?? item.elapsedSeconds;
  }
  return item.elapsedSeconds + Math.max(0, Math.floor((now - item.timingStartedAt) / 1000));
}

function getProgress(item: MiniSubtaskItem, liveElapsed: number) {
  if (!item.countdownEnabled || item.plannedSeconds <= 0) return null;
  return Math.max(0, Math.min(100, (liveElapsed / item.plannedSeconds) * 100));
}

async function updatePinnedSubtaskTodo(
  updater: (todos: Todo[]) => Todo[] ,
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
  void emitAppDataUpdated().catch((error) => {
    console.error("failed to emit app data update", error);
  });
}

type RenderState = "entering" | "visible" | "exiting";

type RenderedPinnedSubtask = {
  item: MiniSubtaskItem;
  state: RenderState;
};

const ITEM_ENTER_GAP = 0.06;
const ITEM_EXIT_GAP = 0.04;
const ITEM_ENTER_DURATION = 0.24;
const ITEM_EXIT_DURATION = 0.16;
const PINNED_SUBTASKS_COLLAPSED_WIDTH = 180;
const PINNED_SUBTASKS_EXPANDED_WIDTH = 380;
const PINNED_SUBTASKS_ITEM_COLLAPSED_HEIGHT = 46;
const PINNED_SUBTASKS_ITEM_EXPANDED_HEIGHT = 54;
const PINNED_SUBTASKS_LIST_GAP = 8;
const PINNED_SUBTASKS_LIST_PADDING = 8;
const PINNED_SUBTASKS_MAX_COLLAPSED_ITEMS = 3;
const PINNED_SUBTASKS_MAX_EXPANDED_ITEMS = 5;
const PINNED_SUBTASKS_MAX_HEIGHT = 400;
const PINNED_PARENT_EXPANDED_HEIGHT = 60;
const PINNED_PARENT_COLLAPSED_HEIGHT = 46;

const pinnedSubtasksFrameTokens = new Map<string, number>();

function getPinnedSubtasksTargetSize(expanded: boolean, itemCount: number) {
  const width = expanded
    ? PINNED_SUBTASKS_EXPANDED_WIDTH
    : PINNED_SUBTASKS_COLLAPSED_WIDTH;
  const shown = expanded
    ? Math.min(itemCount, PINNED_SUBTASKS_MAX_EXPANDED_ITEMS)
    : Math.min(itemCount, PINNED_SUBTASKS_MAX_COLLAPSED_ITEMS);
  const itemHeight = expanded
    ? PINNED_SUBTASKS_ITEM_EXPANDED_HEIGHT
    : PINNED_SUBTASKS_ITEM_COLLAPSED_HEIGHT;
  const height = Math.min(
    shown * itemHeight +
      Math.max(0, shown - 1) * PINNED_SUBTASKS_LIST_GAP +
      PINNED_SUBTASKS_LIST_PADDING,
    PINNED_SUBTASKS_MAX_HEIGHT,
  );
  return { width, height };
}

type PinnedSubtasksFrameTarget = {
  x: number;
  y: number;
  width: number;
  height: number;
  startX: number;
  startY: number;
  startWidth: number;
  startHeight: number;
};

async function getPinnedSubtasksFrameTarget(
  slot: string,
  expanded: boolean,
  itemCount: number,
): Promise<PinnedSubtasksFrameTarget> {
  const { getAllWindows, currentMonitor, getCurrentWindow } = await import(
    "@tauri-apps/api/window"
  );
  const window = getCurrentWindow();
  const monitor = await currentMonitor();
  const scale = monitor?.scaleFactor ?? 1;
  const target = getPinnedSubtasksTargetSize(expanded, itemCount);
  const startSize = (await window.outerSize()).toLogical(scale);
  const startPos = (await window.outerPosition()).toLogical(scale);

  let targetX = startPos.x;
  let targetY = startPos.y;
  if (monitor != null) {
    const work = monitor.workArea.position.toLogical(scale);
    const workSize = monitor.workArea.size.toLogical(scale);
    const gap = 4;
    const windows = await getAllWindows();
    const parentWindow = windows.find(
      (candidate) => candidate.label === `pinned-todo-${slot}`,
    );
    const parentPos = parentWindow
      ? (await parentWindow.outerPosition()).toLogical(scale)
      : null;
    const parentHeight = expanded
      ? PINNED_PARENT_EXPANDED_HEIGHT
      : PINNED_PARENT_COLLAPSED_HEIGHT;

    targetX = work.x + workSize.width - target.width;
    targetY = parentPos != null ? parentPos.y + parentHeight + gap : startPos.y;

    const maxX = work.x + workSize.width - target.width;
    const maxY = work.y + workSize.height - target.height - gap;
    const minX = work.x + gap;
    const minY = work.y + gap;
    if (targetY > maxY) {
      targetY = parentPos != null ? parentPos.y - target.height - gap : maxY;
    }
    targetX = Math.min(Math.max(targetX, minX), Math.max(maxX, minX));
    targetY = Math.min(Math.max(targetY, minY), Math.max(maxY, minY));
  }

  return {
    x: targetX,
    y: targetY,
    width: target.width,
    height: target.height,
    startX: startPos.x,
    startY: startPos.y,
    startWidth: startSize.width,
    startHeight: startSize.height,
  };
}

async function snapPinnedSubtasksWindowFrame(
  slot: string,
  expanded: boolean,
  itemCount: number,
  frame?: PinnedSubtasksFrameTarget,
) {
  const token = (pinnedSubtasksFrameTokens.get(slot) ?? 0) + 1;
  pinnedSubtasksFrameTokens.set(slot, token);

  try {
    const target = frame ?? (await getPinnedSubtasksFrameTarget(slot, expanded, itemCount));
    if (token !== pinnedSubtasksFrameTokens.get(slot)) return;
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("set_pinned_window_frame", {
      x: target.x,
      y: target.y,
      width: target.width,
      height: target.height,
    });
  } catch (error) {
    console.error("failed to snap pinned subtasks window frame", error);
  }
}

async function waitForPinnedParentHeight(
  slot: string,
  targetHeight: number,
  timeoutMs = 300,
) {
  const { getAllWindows, currentMonitor } = await import(
    "@tauri-apps/api/window"
  );
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const windows = await getAllWindows();
    const parentWindow = windows.find(
      (candidate) => candidate.label === `pinned-todo-${slot}`,
    );
    if (parentWindow == null) return;

    const monitor = await currentMonitor();
    const scale = monitor?.scaleFactor ?? 1;
    const height = (await parentWindow.outerSize()).toLogical(scale).height;
    if (Math.abs(height - targetHeight) < 1) return;

    await new Promise((resolve) => window.setTimeout(resolve, 16));
  }
}

async function getPinnedSubtasksCurrentFrame() {
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

export function PinnedSubtasksWindow() {
  const [group, setGroup] = useState<MiniSubtasksGroup | null>(null);
  const [now, setNow] = useState(Date.now());
  const [expanded, setExpanded] = useState(false);
  const [renderedItems, setRenderedItems] = useState<RenderedPinnedSubtask[]>([]);
  const shellRef = useRef<HTMLElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const collapseTimerRef = useRef<number | null>(null);
  const hoverLockUntilRef = useRef(0);
  const hoveredRef = useRef(false);
  const collapseCooldownUntilRef = useRef(0);
  const pendingExpandOnMoveRef = useRef(false);
  const frameTokenRef = useRef(0);
  const frameTweenRef = useRef<ReturnType<typeof gsap.to> | null>(null);
  const renderedItemsRef = useRef<RenderedPinnedSubtask[]>([]);
  const pendingItemsRef = useRef<MiniSubtaskItem[] | null>(null);
  const activeTodoIdRef = useRef<string | null>(null);
  const latestGroupUpdatedAtRef = useRef(0);
  const readyNotifiedRef = useRef(false);
  const enteredItemIdsRef = useRef<Set<string>>(new Set());
  const [frameReady, setFrameReady] = useState(false);
  const slot = new URLSearchParams(window.location.search).get("slot") ?? "";

  useEffect(() => {
    renderedItemsRef.current = renderedItems;
  }, [renderedItems]);

  useEffect(() => {
    return () => {
      if (collapseTimerRef.current != null) {
        window.clearTimeout(collapseTimerRef.current);
      }
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

  useEffect(() => {
    const hasLiveTiming = group?.items.some((item) => item.isTiming) ?? false;
    if (!hasLiveTiming) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [group]);

  const refreshGroupFromStorage = () => {
    if (activeTodoIdRef.current == null) return;
    const result = loadAppData(localStorage);
    const nextTodo = result.data.todos.find((todo) => todo.id === activeTodoIdRef.current);
    const nextGroup = nextTodo
      ? {
          todoId: nextTodo.id,
          parentTitle: nextTodo.title,
          items: (nextTodo.subtasks ?? []).flatMap((subtask) => [
            {
              id: subtask.id,
              title: subtask.title,
              urgency: subtask.urgency,
              completed: subtask.completed,
              countdownEnabled: subtask.countdownEnabled,
              recordTimeEnabled: subtask.recordTimeEnabled,
              plannedSeconds: subtask.plannedSeconds,
              elapsedSeconds: subtask.elapsedSeconds,
              actualDurationSeconds: subtask.actualDurationSeconds,
              isTiming: subtask.isTiming,
              timingStartedAt: subtask.timingStartedAt,
              level: 0,
            },
            ...subtask.children.flatMap((child) => [
              {
                id: child.id,
                title: child.title,
                urgency: child.urgency,
                completed: child.completed,
                countdownEnabled: child.countdownEnabled,
                recordTimeEnabled: child.recordTimeEnabled,
                plannedSeconds: child.plannedSeconds,
                elapsedSeconds: child.elapsedSeconds,
                actualDurationSeconds: child.actualDurationSeconds,
                isTiming: child.isTiming,
                timingStartedAt: child.timingStartedAt,
                level: 1,
              },
            ]),
          ]),
          updatedAt: Date.now(),
        }
      : null;
    setGroup(nextGroup);
    if (nextGroup == null) {
      void closePinnedSubtasksWindow(slot);
    }
  };

  const mutateCurrentTodo = async (updater: (todos: Todo[]) => Todo[]) => {
    try {
      await updatePinnedSubtaskTodo(updater);
      refreshGroupFromStorage();
    } catch (error) {
      console.error("failed to update pinned subtask", error);
    }
  };

  const handleToggleItem = (itemId: string) => {
    if (group == null) return;
    const nowTs = Date.now();
    void mutateCurrentTodo((todos) =>
      toggleTodoSubtask(todos, group.todoId, itemId, nowTs),
    );
  };

  const handleStartItem = (itemId: string) => {
    if (group == null) return;
    void mutateCurrentTodo((todos) =>
      startTodoSubtaskTiming(todos, group.todoId, itemId, Date.now()),
    );
  };

  const handlePauseItem = (itemId: string) => {
    if (group == null) return;
    void mutateCurrentTodo((todos) =>
      pauseTodoSubtaskTiming(todos, group.todoId, itemId, Date.now()),
    );
  };

  const handleStopItem = (itemId: string) => {
    if (group == null) return;
    void mutateCurrentTodo((todos) =>
      stopTodoSubtaskTiming(todos, group.todoId, itemId, Date.now()),
    );
  };

  const handleDeleteItem = (itemId: string) => {
    if (group == null) return;
    void mutateCurrentTodo((todos) =>
      removeTodoSubtask(todos, group.todoId, itemId),
    );
  };

  useEffect(() => {
    document.body.classList.add("is-pinned-subtasks-window");
    const root = document.documentElement;
    const body = document.body;
    const previousBodyBackground = body.style.background;
    const previousBackground = root.style.background;
    root.style.background = "transparent";
    body.style.background = "transparent";

    return () => {
      document.body.classList.remove("is-pinned-subtasks-window");
      body.style.background = previousBodyBackground;
      root.style.background = previousBackground;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | undefined;

    void (async () => {
      try {
        const [{ invoke }, { listen }] = await Promise.all([
          import("@tauri-apps/api/core"),
          import("@tauri-apps/api/event"),
        ]);

        const loadGroup = async () => {
          const activeGroup = parseMiniSubtasksGroup(
            await invoke<string | null>("get_active_pinned_subtasks_group", { slot }),
          );
          if (!cancelled) {
            setGroup(activeGroup);
            activeTodoIdRef.current = activeGroup?.todoId ?? null;
          }
        };

        await loadGroup();

        cleanup = await listen<string>(`dotime-pinned-subtasks-${slot}`, (event) => {
          const nextGroup = parseMiniSubtasksGroup(event.payload);
          setGroup(nextGroup);
          activeTodoIdRef.current = nextGroup?.todoId ?? null;
        });
      } catch (error) {
        console.error("failed to set up pinned subtasks window", error);
      }
    })();

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [slot]);

  // 主应用的数据变化（开始/暂停计时、完成、编辑等）会写入 localStorage 并广播
  // 事件；固定子待办窗口需要跟随刷新，否则倒计时进度等实时数据会一直是旧值。
  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== APP_DATA_STORAGE_KEY) return;
      refreshGroupFromStorage();
    };
    const handleAppDataUpdated = () => {
      refreshGroupFromStorage();
    };

    window.addEventListener("storage", handleStorage);
    window.addEventListener("dotime-app-data-updated", handleAppDataUpdated);
    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("dotime-app-data-updated", handleAppDataUpdated);
    };
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

  useEffect(() => {
    if (group == null) return;
    let cancelled = false;

    void (async () => {
      try {
        const { getAllWindows, currentMonitor } = await import(
          "@tauri-apps/api/window"
        );
        const monitor = await currentMonitor();
        const scale = monitor?.scaleFactor ?? 1;
        const windows = await getAllWindows();
        const parentWindow = windows.find(
          (window) => window.label === `pinned-todo-${slot}`,
        );
        if (parentWindow == null) return;
        const size = await parentWindow.outerSize();
        const parentWidth = size.toLogical(scale).width;
        if (!cancelled && !hoveredRef.current) {
          setExpanded(parentWidth > 300);
        }
      } catch {
        // 父窗口不可用时忽略，保持当前展开状态
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [group, slot]);

  useEffect(() => {
    const nextItems = group?.items ?? [];
    const nextUpdatedAt = group?.updatedAt ?? 0;
    if (nextUpdatedAt <= latestGroupUpdatedAtRef.current) return;
    latestGroupUpdatedAtRef.current = nextUpdatedAt;

    const nextTodoId = group?.todoId ?? null;
    if (nextTodoId !== activeTodoIdRef.current) {
      activeTodoIdRef.current = nextTodoId;
      pendingItemsRef.current = null;
      enteredItemIdsRef.current.clear();
      setRenderedItems(
        nextItems.map((item) => ({ item, state: "entering" as const })),
      );
      return;
    }

    const current = renderedItemsRef.current;
    const activeCurrent = current.filter((entry) => entry.state !== "exiting");
    const currentSignature = activeCurrent
      .map((entry) => entry.item.id)
      .join("|");
    const nextSignature = nextItems.map((item) => item.id).join("|");
    const nextById = new Map(nextItems.map((item) => [item.id, item]));

    if (activeCurrent.length > 0 && currentSignature === nextSignature) {
      setRenderedItems(
        current.map((entry) => ({
          item: nextById.get(entry.item.id) ?? entry.item,
          state: entry.state,
        })),
      );
      return;
    }

    if (activeCurrent.length === 0) {
      pendingItemsRef.current = null;
      enteredItemIdsRef.current.clear();
      setRenderedItems(nextItems.map((item) => ({ item, state: "entering" })));
      return;
    }

    pendingItemsRef.current = nextItems;
    enteredItemIdsRef.current.clear();
    setRenderedItems(current.map((entry) => ({ ...entry, state: "exiting" })));
  }, [group]);

  useEffect(() => {
    if (readyNotifiedRef.current) return;
    if (group == null) return;
    if (renderedItems.length === 0 && group.items.length > 0) return;

    readyNotifiedRef.current = true;
    void (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("pinned_subtasks_window_ready", { slot });
        setFrameReady(true);
      } catch (error) {
        console.error("failed to show pinned subtasks window", error);
      }
    })();
  }, [group, renderedItems, slot]);

  useEffect(() => {
    if (group == null) return;

    void (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("sync_pinned_subtasks_window", {
          slot,
          subtasksGroup: JSON.stringify(group),
        });
      } catch (error) {
        console.error("failed to sync pinned subtasks window state", error);
      }
    })();
  }, [group, slot]);

  useEffect(() => {
    const shell = shellRef.current;
    if (shell == null || group == null || !frameReady) return;

    const itemCount = group.items.length;
    const token = ++frameTokenRef.current;
    frameTweenRef.current?.kill();
    let disposed = false;

    void (async () => {
      if (expanded) {
        try {
          await waitForPinnedParentHeight(
            slot,
            PINNED_PARENT_EXPANDED_HEIGHT,
          );
        } catch (error) {
          console.error("failed to wait for pinned parent frame", error);
        }
      }

      if (disposed || token !== frameTokenRef.current) return;

      let frame: PinnedSubtasksFrameTarget | null = null;
      try {
        frame = await getPinnedSubtasksFrameTarget(slot, expanded, itemCount);
        if (disposed || token !== frameTokenRef.current) return;
      } catch (error) {
        console.error("failed to measure pinned subtasks target", error);
      }

      const start = frame
        ? {
            x: frame.startX,
            y: frame.startY,
            width: frame.startWidth,
            height: frame.startHeight,
          }
        : await getPinnedSubtasksCurrentFrame();
      const targetSize = getPinnedSubtasksTargetSize(expanded, itemCount);
      const end = frame
        ? {
            x: frame.x,
            y: frame.y,
            width: frame.width,
            height: frame.height,
          }
        : { ...start, ...targetSize };

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
            console.error("failed to set pinned subtasks window frame", error);
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
            void snapPinnedSubtasksWindowFrame(
              slot,
              expanded,
              itemCount,
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
  }, [expanded, frameReady, group?.items.length, group?.todoId, slot]);

  useGSAP(
    () => {
      if (!frameReady) return;

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
      );

      if (enteringNodes.length > 0) {
        const timeline = gsap.timeline({
          onComplete: () => {
            setRenderedItems((currentItems) =>
              currentItems.map((entry) =>
                entry.state === "entering" ? { ...entry, state: "visible" } : entry,
              ),
            );
          },
        });

        let cursor = 0.08;
        enteringNodes.forEach((node) => {
          const itemId = node.dataset.itemId;
          if (itemId != null && enteredItemIdsRef.current.has(itemId)) {
            gsap.set(node, { autoAlpha: 1, y: 0 });
            return;
          }
          if (itemId != null) enteredItemIdsRef.current.add(itemId);
          timeline.fromTo(
            node,
            { autoAlpha: 0, y: 0 },
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
            if (pendingItems != null && pendingItems.length > 0) {
              setRenderedItems(
                pendingItems.map((item) => ({ item, state: "entering" })),
              );
              return;
            }
            setRenderedItems((currentItems) =>
              currentItems.filter((entry) => entry.state !== "exiting"),
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
    { dependencies: [frameReady, renderedItems], scope: listRef },
  );

  return (
    <main
      ref={shellRef}
      className={`mini-subtasks-window pinned-subtasks-window ${
        expanded ? "is-expanded" : "is-collapsed"
      }`}
      aria-label="固定子待办窗口"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onPointerMove={handleShellPointerMove}
    >
      <button
        type="button"
        className="mini-subtasks-window__close"
        onClick={() => void closePinnedSubtasksWindow(slot)}
        aria-label="关闭固定子待办窗口"
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
            const progress = getProgress(item, liveElapsed);

            return (
              <article
                key={item.id}
                className={`mini-subtasks-window__item ${
                  item.completed ? "is-completed" : ""
                } ${countdownEnabled ? "has-countdown" : ""} is-${entry.state}`}
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
                <div className="mini-subtasks-window__body">
                  <div className="mini-subtasks-window__title-row">
                    <span className="mini-subtasks-window__title">
                      {item.title}
                    </span>
                    <span
                      className={`urgency-icon urgency-icon--${item.urgency}`}
                      title={`紧急程度：${URGENCY_LABELS[item.urgency]}`}
                      aria-label={`紧急程度：${URGENCY_LABELS[item.urgency]}`}
                    >
                      <IconFlame size={13} />
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
                  {expanded && (
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
                            {item.isTiming ||
                            item.actualDurationSeconds == null
                              ? formatDuration(liveElapsed)
                              : formatDurationHuman(item.actualDurationSeconds)}
                          </span>
                        )}
                      </div>
                      <div className="mini-subtasks-window__actions">
                        {(item.countdownEnabled || item.recordTimeEnabled) &&
                          (item.isTiming ? (
                            <>
                              <button
                                type="button"
                                className="pinned-card-action"
                                onClick={() => handlePauseItem(item.id)}
                                aria-label="暂停计时"
                                title="暂停计时"
                              >
                                <IconPlayerPause size={14} />
                              </button>
                              <button
                                type="button"
                                className="pinned-card-action"
                                onClick={() => handleStopItem(item.id)}
                                aria-label="结束计时"
                                title="结束计时"
                              >
                                <IconPlayerStop size={14} />
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              className="pinned-card-action"
                              onClick={() => handleStartItem(item.id)}
                              aria-label="开始计时"
                              title="开始计时"
                            >
                              <IconPlayerPlay size={14} />
                            </button>
                          ))}
                        <button
                          type="button"
                          className="pinned-card-action is-danger"
                          onClick={() => handleDeleteItem(item.id)}
                          aria-label="删除子待办"
                          title="删除子待办"
                        >
                          <IconTrash size={14} />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                {countdownEnabled && liveElapsed > 0 && (
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
