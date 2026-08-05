import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { MiniTodoBar } from "./components/MiniTodoBar";
import { GlobalSearch } from "./components/GlobalSearch";
import { StatisticsCenter } from "./components/StatisticsCenter";
import { DataActions } from "./components/DataActions";
import { DateNavigator } from "./components/DateNavigator";
import {
  createDefaultTodoDraft,
  TodoEditorForm,
} from "./components/TodoEditorForm";
import type { TodoDraft } from "./components/TodoEditorForm";
import { TodoForm } from "./components/TodoForm";
import { TodoItem } from "./components/TodoItem";
import {
  WindowControls,
  toggleMaximizeFromTitlebar,
} from "./components/WindowControls";
import {
  IconChevronUp,
  IconChartBar,
  IconCircleCheck,
  IconClipboardText,
  IconClockHour4,
  IconClose,
  IconListCheck,
  IconDockTop,
  IconPencil,
  IconPlus,
  IconRepeat,
  IconThemeMoon,
  IconThemeSun,
  IconTrash,
} from "./components/icons";
import type { StatisticsPeriod } from "./domain/statistics";
import { useTodos } from "./hooks/useTodos";
import { useTaskTemplates } from "./hooks/useTaskTemplates";
import type { Todo, TodoSubtask } from "./types";
import { loadTheme, saveTheme, toggleTheme } from "./utils/theme";
import {
  formatClockTime,
  formatDateKey,
  formatDurationCompact,
  formatDisplayDate,
} from "./utils/time";
import {
  collapseMiniWindowMode,
  ensureDefaultWindowMode,
  enterMiniWindowMode,
  exitMiniWindowMode,
  revealMiniWindowMode,
} from "./utils/windowMode";
import { setWindowOpacity } from "./utils/windowOpacity";
import "./App.css";

const MINI_OPACITY_STORAGE_KEY = "dotime:mini-opacity";
const MINI_OPACITY_MIN = 0.35;
const MINI_OPACITY_MAX = 1;
const MINI_OPACITY_STEP = 0.05;
const TODO_HIGHLIGHT_MS = 2000;
const TODO_DRAG_LONG_PRESS_MS = 180;
const TODO_DRAG_CANCEL_DISTANCE = 8;
const TODO_DRAG_SWAP_UP_THRESHOLD = 0.4;
const TODO_DRAG_SWAP_DOWN_THRESHOLD = 0.6;

type TodoDragState = {
  pointerId: number;
  draggedId: string;
  startX: number;
  startY: number;
  active: boolean;
  longPressTimer: number;
};

type SubtaskEditorTarget = {
  todoId: string;
  parentSubtaskId: string | null;
} & (
  | { mode: "add" }
  | { mode: "edit"; subtaskId: string }
);

type SubtaskDeleteTarget = {
  todoId: string;
  subtaskId: string;
};

type SubtaskSyncTarget = {
  todoId: string;
  subtaskId: string;
};

function findTodoSubtask(
  subtasks: readonly TodoSubtask[] = [],
  id: string,
): TodoSubtask | null {
  for (const subtask of subtasks) {
    if (subtask.id === id) return subtask;
    const child = findTodoSubtask(subtask.children, id);
    if (child != null) return child;
  }
  return null;
}

function getSubtaskEditorDraft(
  target: SubtaskEditorTarget | null,
  todos: readonly Todo[],
  selectedDate: string,
): TodoDraft {
  if (target?.mode !== "edit") return createDefaultTodoDraft(selectedDate);
  const todo = todos.find((item) => item.id === target.todoId);
  const subtask =
    todo == null ? null : findTodoSubtask(todo.subtasks, target.subtaskId);
  if (subtask == null) return createDefaultTodoDraft(selectedDate);

  return {
    ...createDefaultTodoDraft(selectedDate),
    title: subtask.title,
    urgency: subtask.urgency,
    plannedSeconds:
      subtask.plannedSeconds > 0 ? subtask.plannedSeconds : 25 * 60,
    countdownEnabled: subtask.countdownEnabled,
    recordTimeEnabled: subtask.recordTimeEnabled,
  };
}

function clampMiniOpacity(value: number) {
  return Math.min(MINI_OPACITY_MAX, Math.max(MINI_OPACITY_MIN, value));
}

function loadMiniOpacity() {
  const stored = Number(localStorage.getItem(MINI_OPACITY_STORAGE_KEY));
  return Number.isFinite(stored) ? clampMiniOpacity(stored) : 1;
}

async function showClipboardWindow() {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("show_clipboard_window").catch((error) => {
    console.error("failed to show clipboard window", error);
  });
}

function App() {
  const [selectedDate, setSelectedDate] = useState(() => formatDateKey());
  const [todoFormOpen, setTodoFormOpen] = useState(false);
  const [editingTodoId, setEditingTodoId] = useState<string | null>(null);
  const [subtaskEditorTarget, setSubtaskEditorTarget] =
    useState<SubtaskEditorTarget | null>(null);
  const [theme, setTheme] = useState(() => loadTheme());
  const [miniMode, setMiniMode] = useState(false);
  const [miniIndex, setMiniIndex] = useState(0);
  const [miniAutoHideEnabled, setMiniAutoHideEnabled] = useState(false);
  const [miniAutoHideRevealed, setMiniAutoHideRevealed] = useState(true);
  const [miniOpacity, setMiniOpacity] = useState(() => loadMiniOpacity());
  const [mainView, setMainView] = useState<"todos" | "statistics">("todos");
  const [statisticsPeriod, setStatisticsPeriod] =
    useState<StatisticsPeriod>("week");
  const [highlightedTodoId, setHighlightedTodoId] = useState<string | null>(
    null,
  );
  const [pendingDeleteTodoId, setPendingDeleteTodoId] = useState<string | null>(
    null,
  );
  const [pendingResetTodoId, setPendingResetTodoId] = useState<string | null>(
    null,
  );
  const [pendingClearAll, setPendingClearAll] = useState(false);
  const [pendingDeleteSubtask, setPendingDeleteSubtask] =
    useState<SubtaskDeleteTarget | null>(null);
  const [pendingSyncSubtask, setPendingSyncSubtask] =
    useState<SubtaskSyncTarget | null>(null);
  const [hasBodyOverflow, setHasBodyOverflow] = useState(false);
  const appBodyRef = useRef<HTMLElement | null>(null);
  const confirmDeleteButtonRef = useRef<HTMLButtonElement | null>(null);
  const todoItemRefs = useRef(new Map<string, HTMLElement>());
  const highlightTimerRef = useRef<number | null>(null);
  const dragStateRef = useRef<TodoDragState | null>(null);
  const dayTodoIdsRef = useRef<string[]>([]);
  const [draggingTodoId, setDraggingTodoId] = useState<string | null>(null);
  const {
    allTodos,
    dayTodos,
    stats,
    todoDateSummaries,
    addTodo,
    removeTodo,
    clearDayTodos,
    reorderTodo,
    toggleComplete,
    updateTodo,
    updateComment,
    addSubtask,
    updateSubtask,
    syncSubtaskElapsedFromParent,
    toggleSubtask,
    removeSubtask,
    reorderSubtask,
    startSubtaskTiming,
    pauseSubtaskTiming,
    stopSubtaskTiming,
    startTiming,
    pauseTiming,
    stopTiming,
    resetTiming,
    getLiveElapsed,
    getCountdownRemaining,
    exportTodosData,
    exportSelectedDateData,
    importTodosData,
    storageNotice,
  } = useTodos(selectedDate);
  const {
    templates,
    notice: templateNotice,
    addTemplate,
    renameTemplate,
    removeTemplate,
    moveTemplate,
  } = useTaskTemplates();

  useEffect(() => {
    saveTheme(theme);
  }, [theme]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    void (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const appWindow = getCurrentWindow();

        unlisten = await appWindow.onCloseRequested(async (event) => {
          event.preventDefault();
          await invoke("hide_main_window");
        });

        if (cancelled && unlisten) unlisten();
      } catch {
        /* browser */
      }
    })();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (!miniMode) void ensureDefaultWindowMode();
  }, [miniMode]);

  useEffect(() => {
    document.body.classList.toggle("is-mini-mode", miniMode);
    return () => document.body.classList.remove("is-mini-mode");
  }, [miniMode]);

  useEffect(() => {
    localStorage.setItem(MINI_OPACITY_STORAGE_KEY, String(miniOpacity));
  }, [miniOpacity]);

  useEffect(() => {
    if (miniMode) void setWindowOpacity(miniOpacity);
  }, [miniMode, miniOpacity]);

  const editingTodo = editingTodoId
    ? dayTodos.find((todo) => todo.id === editingTodoId) ?? null
    : null;
  const showingEditor =
    todoFormOpen || editingTodo != null || subtaskEditorTarget != null;
  const unfinishedTodos = dayTodos.filter((todo) => !todo.completed);
  const canEnterMiniMode = unfinishedTodos.length > 0;
  const activeMiniIndex =
    unfinishedTodos.length === 0
      ? 0
      : Math.min(miniIndex, unfinishedTodos.length - 1);
  const miniTodo = unfinishedTodos[activeMiniIndex] ?? null;
  const pendingDeleteTodo = pendingDeleteTodoId
    ? dayTodos.find((todo) => todo.id === pendingDeleteTodoId) ?? null
    : null;
  const pendingResetTodo = pendingResetTodoId
    ? dayTodos.find((todo) => todo.id === pendingResetTodoId) ?? null
    : null;
  const pendingDeleteSubtaskTodo = pendingDeleteSubtask
    ? dayTodos.find((todo) => todo.id === pendingDeleteSubtask.todoId) ?? null
    : null;
  const pendingDeleteSubtaskItem =
    pendingDeleteSubtaskTodo == null || pendingDeleteSubtask == null
      ? null
      : findTodoSubtask(
          pendingDeleteSubtaskTodo.subtasks,
          pendingDeleteSubtask.subtaskId,
        );
  const pendingDeleteTitle =
    pendingDeleteSubtask != null ? "删除这个子待办？" : "删除这个待办？";
  const pendingDeleteDescription =
    pendingDeleteSubtask != null
      ? pendingDeleteSubtaskItem
        ? `「${pendingDeleteSubtaskItem.title}」将被移除，包含它的下级子待办。`
        : "这个子待办将从列表中移除。"
      : pendingDeleteTodo
        ? `「${pendingDeleteTodo.title}」将从今天的列表中移除。`
        : "这个待办将从列表中移除。";
  const pendingSyncSubtaskTodo = pendingSyncSubtask
    ? dayTodos.find((todo) => todo.id === pendingSyncSubtask.todoId) ?? null
    : null;
  const pendingSyncSubtaskItem =
    pendingSyncSubtaskTodo == null || pendingSyncSubtask == null
      ? null
      : findTodoSubtask(
          pendingSyncSubtaskTodo.subtasks,
          pendingSyncSubtask.subtaskId,
        );
  const pendingSyncDescription =
    pendingSyncSubtaskTodo != null && pendingSyncSubtaskItem != null
      ? `「${pendingSyncSubtaskItem.title}」的已用时间将同步为父待办「${pendingSyncSubtaskTodo.title}」当前的已用时间。`
      : "这个子待办的已用时间将同步为父待办当前的已用时间。";
  const pendingResetDescription = pendingResetTodo
    ? `将清空「${pendingResetTodo.title}」当前的倒计时和已用时间，并停止正在进行的计时。`
    : "将清空这个待办当前的倒计时和已用时间，并停止正在进行的计时。";

  useEffect(() => {
    if (miniIndex !== activeMiniIndex) setMiniIndex(activeMiniIndex);
  }, [activeMiniIndex, miniIndex]);

  useEffect(() => {
    if (miniMode && !canEnterMiniMode) void handleExitMiniMode();
  }, [canEnterMiniMode, miniMode]);

  useEffect(() => {
    if (
      !pendingDeleteTodoId &&
      !pendingResetTodoId &&
      !pendingClearAll &&
      pendingDeleteSubtask == null &&
      pendingSyncSubtask == null
    ) {
      return;
    }
    window.requestAnimationFrame(() => confirmDeleteButtonRef.current?.focus());
  }, [
    pendingClearAll,
    pendingDeleteSubtask,
    pendingDeleteTodoId,
    pendingResetTodoId,
    pendingSyncSubtask,
  ]);

  useEffect(() => {
    if (
      !pendingDeleteTodoId &&
      !pendingResetTodoId &&
      !pendingClearAll &&
      pendingDeleteSubtask == null &&
      pendingSyncSubtask == null
    ) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPendingDeleteTodoId(null);
        setPendingResetTodoId(null);
        setPendingClearAll(false);
        setPendingDeleteSubtask(null);
        setPendingSyncSubtask(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    pendingClearAll,
    pendingDeleteSubtask,
    pendingDeleteTodoId,
    pendingResetTodoId,
    pendingSyncSubtask,
  ]);

  useEffect(
    () => () => {
      if (highlightTimerRef.current != null) {
        window.clearTimeout(highlightTimerRef.current);
      }
      if (dragStateRef.current != null) {
        window.clearTimeout(dragStateRef.current.longPressTimer);
      }
    },
    [],
  );

  useEffect(() => {
    document.body.classList.toggle("is-todo-dragging", draggingTodoId != null);
    return () => document.body.classList.remove("is-todo-dragging");
  }, [draggingTodoId]);

  useEffect(() => {
    dayTodoIdsRef.current = dayTodos.map((todo) => todo.id);
  }, [dayTodos]);

  useEffect(() => {
    const appBody = appBodyRef.current;
    if (!appBody) return;

    const updateBodyOverflow = () => {
      setHasBodyOverflow(appBody.scrollHeight > appBody.clientHeight + 1);
    };

    updateBodyOverflow();

    const resizeObserver = new ResizeObserver(updateBodyOverflow);
    resizeObserver.observe(appBody);
    if (appBody.firstElementChild) {
      resizeObserver.observe(appBody.firstElementChild);
    }

    window.addEventListener("resize", updateBodyOverflow);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateBodyOverflow);
    };
  }, [dayTodos.length, mainView, showingEditor]);

  const handleOpenNewTodo = (open: boolean) => {
    setTodoFormOpen(open);
    if (open) {
      setEditingTodoId(null);
      setSubtaskEditorTarget(null);
      setMainView("todos");
    }
  };

  const handleStartEdit = (id: string) => {
    setMainView("todos");
    setEditingTodoId(id);
    setTodoFormOpen(false);
    setSubtaskEditorTarget(null);
  };

  const handleStartAddSubtask = (
    todoId: string,
    parentSubtaskId: string | null,
  ) => {
    setMainView("todos");
    setEditingTodoId(null);
    setTodoFormOpen(false);
    setSubtaskEditorTarget({ mode: "add", todoId, parentSubtaskId });
  };

  const handleStartEditSubtask = (todoId: string, subtaskId: string) => {
    setMainView("todos");
    setEditingTodoId(null);
    setTodoFormOpen(false);
    setSubtaskEditorTarget({
      mode: "edit",
      todoId,
      parentSubtaskId: null,
      subtaskId,
    });
  };

  const handleEnterMiniMode = async () => {
    if (!canEnterMiniMode) return;

    setEditingTodoId(null);
    setTodoFormOpen(false);
    setSubtaskEditorTarget(null);
    setMiniIndex(0);
    setMiniAutoHideEnabled(false);
    setMiniAutoHideRevealed(true);
    await enterMiniWindowMode();
    setMiniMode(true);
  };

  const handleExitMiniMode = async () => {
    setMiniMode(false);
    setMiniAutoHideEnabled(false);
    setMiniAutoHideRevealed(true);
    await setWindowOpacity(1);
    await exitMiniWindowMode();
  };

  const handleToggleMiniAutoHide = async () => {
    if (miniAutoHideEnabled) {
      setMiniAutoHideEnabled(false);
      setMiniAutoHideRevealed(true);
      await revealMiniWindowMode();
      return;
    }

    setMiniAutoHideEnabled(true);
    setMiniAutoHideRevealed(false);
    await collapseMiniWindowMode();
  };

  const handleRevealMiniMode = async () => {
    if (!miniAutoHideEnabled || miniAutoHideRevealed) return;
    setMiniAutoHideRevealed(true);
    await revealMiniWindowMode();
  };

  const handleHideMiniMode = async () => {
    if (!miniAutoHideEnabled || !miniAutoHideRevealed) return;
    setMiniAutoHideRevealed(false);
    await collapseMiniWindowMode();
  };

  const handleRemoveTodo = (id: string) => {
    if (miniMode) {
      void handleExitMiniMode().then(() => setPendingDeleteTodoId(id));
      return;
    }

    setPendingDeleteTodoId(id);
  };

  const handleOpenClearAll = () => {
    if (dayTodos.length === 0) return;
    setPendingClearAll(true);
  };

  const handleCancelClearAll = () => {
    setPendingClearAll(false);
  };

  const handleConfirmClearAll = () => {
    clearDayTodos();
    setPendingClearAll(false);
  };

  const handleCancelDeleteTodo = () => {
    setPendingDeleteTodoId(null);
    setPendingDeleteSubtask(null);
  };

  const handleCancelResetTodo = () => {
    setPendingResetTodoId(null);
  };

  const handleConfirmDeleteTodo = () => {
    if (pendingDeleteSubtask != null) {
      removeSubtask(pendingDeleteSubtask.todoId, pendingDeleteSubtask.subtaskId);
      setPendingDeleteSubtask(null);
      return;
    }

    if (pendingDeleteTodoId) removeTodo(pendingDeleteTodoId);
    setPendingDeleteTodoId(null);
  };

  const handleConfirmResetTodo = () => {
    if (pendingResetTodoId == null) return;
    resetTiming(pendingResetTodoId);
    setPendingResetTodoId(null);
  };

  const handleCancelSyncSubtask = () => {
    setPendingSyncSubtask(null);
  };

  const handleConfirmSyncSubtask = () => {
    if (pendingSyncSubtask == null) return;
    syncSubtaskElapsedFromParent(
      pendingSyncSubtask.todoId,
      pendingSyncSubtask.subtaskId,
    );
    setPendingSyncSubtask(null);
  };

  const finishTodoDrag = () => {
    const dragState = dragStateRef.current;
    if (dragState) window.clearTimeout(dragState.longPressTimer);
    window.removeEventListener("pointermove", handleTodoDragMove);
    window.removeEventListener("pointerup", handleTodoDragEnd);
    window.removeEventListener("pointercancel", handleTodoDragEnd);
    dragStateRef.current = null;
    setDraggingTodoId(null);
  };

  const handleTodoDragMove = (event: globalThis.PointerEvent) => {
    const dragState = dragStateRef.current;
    if (!dragState || event.pointerId !== dragState.pointerId) return;

    const movedDistance = Math.hypot(
      event.clientX - dragState.startX,
      event.clientY - dragState.startY,
    );

    if (!dragState.active) {
      if (movedDistance > TODO_DRAG_CANCEL_DISTANCE) finishTodoDrag();
      return;
    }

    event.preventDefault();
    const target = document.elementFromPoint(event.clientX, event.clientY);
    const targetItem = target?.closest<HTMLElement>("[data-todo-id]");
    const targetId = targetItem?.dataset.todoId;
    if (!targetId || targetId === dragState.draggedId) return;

    const currentOrder = dayTodoIdsRef.current;
    const draggedIndex = currentOrder.indexOf(dragState.draggedId);
    const targetIndex = currentOrder.indexOf(targetId);
    if (draggedIndex < 0 || targetIndex < 0) return;

    const targetRect = targetItem.getBoundingClientRect();
    const relativeY = (event.clientY - targetRect.top) / targetRect.height;
    const isMovingDown = targetIndex > draggedIndex;
    const crossedSwapLine = isMovingDown
      ? relativeY >= TODO_DRAG_SWAP_DOWN_THRESHOLD
      : relativeY <= TODO_DRAG_SWAP_UP_THRESHOLD;
    if (!crossedSwapLine) return;

    const nextOrder = [...currentOrder];
    const [draggedId] = nextOrder.splice(draggedIndex, 1);
    nextOrder.splice(targetIndex, 0, draggedId);
    dayTodoIdsRef.current = nextOrder;

    reorderTodo(dragState.draggedId, targetId);
  };

  const handleTodoDragEnd = (event: globalThis.PointerEvent) => {
    const dragState = dragStateRef.current;
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    finishTodoDrag();
  };

  const handleTodoDragHandlePointerDown =
    (id: string) => (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0) return;

      event.preventDefault();
      event.stopPropagation();

      finishTodoDrag();

      const dragState: TodoDragState = {
        pointerId: event.pointerId,
        draggedId: id,
        startX: event.clientX,
        startY: event.clientY,
        active: false,
        longPressTimer: window.setTimeout(() => {
          const current = dragStateRef.current;
          if (!current || current.pointerId !== event.pointerId) return;
          current.active = true;
          setDraggingTodoId(id);
        }, TODO_DRAG_LONG_PRESS_MS),
      };

      dragStateRef.current = dragState;
      window.addEventListener("pointermove", handleTodoDragMove, {
        passive: false,
      });
      window.addEventListener("pointerup", handleTodoDragEnd);
      window.addEventListener("pointercancel", handleTodoDragEnd);
    };

  const setTodoItemRef = (id: string) => (node: HTMLElement | null) => {
    if (node) {
      todoItemRefs.current.set(id, node);
      return;
    }
    todoItemRefs.current.delete(id);
  };

  const scrollTodoIntoView = (id: string) => {
    window.requestAnimationFrame(() => {
      const node = todoItemRefs.current.get(id);
      node?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  };

  const flashTodo = (id: string) => {
    if (highlightTimerRef.current != null) {
      window.clearTimeout(highlightTimerRef.current);
    }
    setHighlightedTodoId(null);
    window.requestAnimationFrame(() => setHighlightedTodoId(id));
    highlightTimerRef.current = window.setTimeout(() => {
      highlightTimerRef.current = null;
      setHighlightedTodoId(null);
    }, TODO_HIGHLIGHT_MS);
  };

  const handleScrollToTop = () => {
    appBodyRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  };

  const moveMiniTodo = (direction: -1 | 1) => {
    setMiniIndex((index) =>
      unfinishedTodos.length <= 1
        ? index
        : (index + direction + unfinishedTodos.length) %
          unfinishedTodos.length,
    );
  };

  const changeMiniOpacity = (direction: -1 | 1) => {
    setMiniOpacity((current) =>
      clampMiniOpacity(
        Number((current + direction * MINI_OPACITY_STEP).toFixed(2)),
      ),
    );
  };

  const handleSubmitEdit = (draft: TodoDraft) => {
    if (!editingTodo) return;
    updateTodo(editingTodo.id, draft);
    setEditingTodoId(null);
    setSelectedDate(draft.date);
  };

  const handleSubmitSubtask = (draft: TodoDraft) => {
    if (subtaskEditorTarget == null) return;
    const details = {
      title: draft.title,
      urgency: draft.urgency,
      plannedSeconds: draft.plannedSeconds,
      countdownEnabled: draft.countdownEnabled,
      recordTimeEnabled: draft.recordTimeEnabled,
    };
    if (subtaskEditorTarget.mode === "edit") {
      updateSubtask(
        subtaskEditorTarget.todoId,
        subtaskEditorTarget.subtaskId,
        details,
      );
    } else {
      addSubtask(
        subtaskEditorTarget.todoId,
        subtaskEditorTarget.parentSubtaskId,
        details,
      );
    }
    setSubtaskEditorTarget(null);
  };

  const deleteConfirmDialog =
    pendingDeleteTodoId || pendingDeleteSubtask != null ? (
    <div
      className="confirm-overlay"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) handleCancelDeleteTodo();
      }}
    >
      <section
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-confirm-title"
        aria-describedby="delete-confirm-desc"
      >
        <div className="confirm-dialog__icon" aria-hidden>
          <IconTrash size={20} />
        </div>
        <div className="confirm-dialog__content">
          <div className="confirm-dialog__header">
            <h2 id="delete-confirm-title">{pendingDeleteTitle}</h2>
            <button
              type="button"
              className="btn btn-ghost btn-icon-only confirm-dialog__close"
              onClick={handleCancelDeleteTodo}
              aria-label="取消删除"
              title="取消删除"
            >
              <IconClose size={16} />
            </button>
          </div>
          <p id="delete-confirm-desc">{pendingDeleteDescription}</p>
          <div className="confirm-dialog__actions">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={handleCancelDeleteTodo}
            >
              取消
            </button>
            <button
              ref={confirmDeleteButtonRef}
              type="button"
              className="btn btn-danger btn-sm"
              onClick={handleConfirmDeleteTodo}
            >
              <IconTrash size={14} />
              删除
            </button>
          </div>
        </div>
      </section>
    </div>
  ) : null;

  const resetConfirmDialog = pendingResetTodoId != null ? (
    <div
      className="confirm-overlay"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) handleCancelResetTodo();
      }}
    >
      <section
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="reset-confirm-title"
        aria-describedby="reset-confirm-desc"
      >
        <div className="confirm-dialog__icon" aria-hidden>
          <IconRepeat size={20} />
        </div>
        <div className="confirm-dialog__content">
          <div className="confirm-dialog__header">
            <h2 id="reset-confirm-title">重置倒计时和计时？</h2>
            <button
              type="button"
              className="btn btn-ghost btn-icon-only confirm-dialog__close"
              onClick={handleCancelResetTodo}
              aria-label="取消重置"
              title="取消重置"
            >
              <IconClose size={16} />
            </button>
          </div>
          <p id="reset-confirm-desc">{pendingResetDescription}</p>
          <div className="confirm-dialog__actions">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={handleCancelResetTodo}
            >
              取消
            </button>
            <button
              ref={confirmDeleteButtonRef}
              type="button"
              className="btn btn-primary btn-sm"
              onClick={handleConfirmResetTodo}
            >
              <IconRepeat size={14} />
              重置
            </button>
          </div>
        </div>
      </section>
    </div>
  ) : null;

  const clearAllConfirmDialog = pendingClearAll ? (
    <div
      className="confirm-overlay"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) handleCancelClearAll();
      }}
    >
      <section
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="clear-all-confirm-title"
        aria-describedby="clear-all-confirm-desc"
      >
        <div className="confirm-dialog__icon" aria-hidden>
          <IconTrash size={20} />
        </div>
        <div className="confirm-dialog__content">
          <div className="confirm-dialog__header">
            <h2 id="clear-all-confirm-title">删除当日的全部待办？</h2>
            <button
              type="button"
              className="btn btn-ghost btn-icon-only confirm-dialog__close"
              onClick={handleCancelClearAll}
              aria-label="取消删除当日全部待办"
              title="取消删除当日全部待办"
            >
              <IconClose size={16} />
            </button>
          </div>
          <p id="clear-all-confirm-desc">
            将删除 {formatDisplayDate(selectedDate)} 当天的全部 {dayTodos.length}{" "}
            个待办（包含子待办和计时记录），此操作不可撤销。
          </p>
          <div className="confirm-dialog__actions">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={handleCancelClearAll}
            >
              取消
            </button>
            <button
              ref={confirmDeleteButtonRef}
              type="button"
              className="btn btn-danger btn-sm"
              onClick={handleConfirmClearAll}
            >
              <IconTrash size={14} />
              全部删除
            </button>
          </div>
        </div>
      </section>
    </div>
  ) : null;

  const syncConfirmDialog = pendingSyncSubtask != null ? (
    <div
      className="confirm-overlay"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) handleCancelSyncSubtask();
      }}
    >
      <section
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="sync-confirm-title"
        aria-describedby="sync-confirm-desc"
      >
        <div className="confirm-dialog__icon" aria-hidden>
          <IconRepeat size={20} />
        </div>
        <div className="confirm-dialog__content">
          <div className="confirm-dialog__header">
            <h2 id="sync-confirm-title">同步父待办已用时间？</h2>
            <button
              type="button"
              className="btn btn-ghost btn-icon-only confirm-dialog__close"
              onClick={handleCancelSyncSubtask}
              aria-label="取消同步"
              title="取消同步"
            >
              <IconClose size={16} />
            </button>
          </div>
          <p id="sync-confirm-desc">{pendingSyncDescription}</p>
          <div className="confirm-dialog__actions">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={handleCancelSyncSubtask}
            >
              取消
            </button>
            <button
              ref={confirmDeleteButtonRef}
              type="button"
              className="btn btn-primary btn-sm"
              onClick={handleConfirmSyncSubtask}
            >
              <IconRepeat size={14} />
              同步
            </button>
          </div>
        </div>
      </section>
    </div>
  ) : null;

  if (miniMode) {
    return (
      <div className="app app--mini">
        <MiniTodoBar
          todo={miniTodo}
          index={activeMiniIndex}
          total={unfinishedTodos.length}
          liveElapsed={miniTodo ? getLiveElapsed(miniTodo) : 0}
          remaining={miniTodo ? getCountdownRemaining(miniTodo) : 0}
          onWheelNavigate={moveMiniTodo}
          onOpacityChange={changeMiniOpacity}
          autoHideEnabled={miniAutoHideEnabled}
          autoHideRevealed={miniAutoHideRevealed}
          onToggleAutoHide={() => void handleToggleMiniAutoHide()}
          onReveal={() => void handleRevealMiniMode()}
          onHide={() => void handleHideMiniMode()}
          onStart={() => {
            if (miniTodo) startTiming(miniTodo.id);
          }}
          onPause={() => {
            if (miniTodo) pauseTiming(miniTodo.id);
          }}
          onToggle={() => {
            if (miniTodo) toggleComplete(miniTodo.id);
          }}
          onRemove={() => {
            if (miniTodo) handleRemoveTodo(miniTodo.id);
          }}
          onRestore={() => void handleExitMiniMode()}
        />
        {deleteConfirmDialog}
        {resetConfirmDialog}
        {clearAllConfirmDialog}
        {syncConfirmDialog}
      </div>
    );
  }

  return (
    <div className="app">
      <header
        className="titlebar"
      >
        <div
          className="brand"
          data-tauri-drag-region
          onDoubleClick={() => void toggleMaximizeFromTitlebar()}
        >
          <img
            src="/logo.png"
            alt="doTime"
            className="app-logo"
            draggable={false}
          />
          <div data-tauri-drag-region>
            <h1 className="brand__title" data-tauri-drag-region>
              doTime
            </h1>
            <p className="brand__sub" data-tauri-drag-region>
              每日待办 · 倒计时 · 耗时统计
            </p>
          </div>
        </div>

        <div
          className="titlebar-drag"
          data-tauri-drag-region
          onDoubleClick={() => void toggleMaximizeFromTitlebar()}
        />

        <div className="titlebar-actions">
          <button
            type="button"
            className="btn btn-ghost btn-icon-only clipboard-window-toggle"
            onClick={() => void showClipboardWindow()}
            aria-label="打开剪贴板窗口"
            title="剪贴板"
          >
            <IconClipboardText size={17} />
          </button>
          <section className="stats-row" aria-label="日期统计">
            <div className="stat-card" title="待办">
              <span className="stat-card__icon">
                <IconListCheck size={14} />
              </span>
              <span className="stat-card__label">待办</span>
              <span className="stat-card__value">{stats.total}</span>
            </div>
            <div className="stat-card" title="已完成">
              <span className="stat-card__icon stat-card__icon--success">
                <IconCircleCheck size={14} />
              </span>
              <span className="stat-card__label">已完成</span>
              <span className="stat-card__value">{stats.done}</span>
            </div>
            <div className="stat-card" title="计时中">
              <span className="stat-card__icon stat-card__icon--primary">
                <IconClockHour4 size={14} />
              </span>
              <span className="stat-card__label">计时中</span>
              <span className="stat-card__value">{stats.timing}</span>
            </div>
            <div className="stat-card" title="总耗时">
              <span className="stat-card__icon">
                <IconClockHour4 size={14} />
              </span>
              <span className="stat-card__label">总耗时</span>
              <span className="stat-card__value stat-card__value--sm">
                {stats.totalActual > 0
                  ? formatDurationCompact(stats.totalActual)
                  : "—"}
              </span>
            </div>
          </section>
          <DateNavigator
            value={selectedDate}
            todoSummaries={todoDateSummaries}
            onChange={setSelectedDate}
          />
          <DataActions
            notice={storageNotice}
            selectedDate={selectedDate}
            selectedTodoCount={dayTodos.length}
            onExportAll={exportTodosData}
            onExportSelectedDate={exportSelectedDateData}
            onImport={importTodosData}
          />
          <button
            type="button"
            className={`btn btn-ghost btn-icon-only statistics-toggle ${
              mainView === "statistics" ? "is-active" : ""
            }`}
            onClick={() => {
              setMainView((view) =>
                view === "statistics" ? "todos" : "statistics",
              );
              setTodoFormOpen(false);
              setEditingTodoId(null);
            }}
            aria-label={mainView === "statistics" ? "返回待办" : "查看耗时统计"}
            aria-pressed={mainView === "statistics"}
            title={mainView === "statistics" ? "返回待办" : "耗时统计"}
          >
            <IconChartBar size={17} />
          </button>
          <button
            type="button"
            className="btn btn-primary btn-icon-only titlebar-add-todo"
            onClick={() => handleOpenNewTodo(true)}
            aria-label="新建待办"
            title="新建待办"
          >
            <IconPlus size={17} />
          </button>
          <GlobalSearch
            todos={allTodos}
            anchorDate={selectedDate}
            todoDateSummaries={todoDateSummaries}
            onSelectTodo={(todo) => {
              setSelectedDate(todo.date);
              setMainView("todos");
              setTodoFormOpen(false);
              setEditingTodoId(null);
              scrollTodoIntoView(todo.id);
              flashTodo(todo.id);
            }}
          />
          <button
            type="button"
            className="btn btn-ghost btn-icon-only theme-toggle"
            onClick={() => setTheme((currentTheme) => toggleTheme(currentTheme))}
            aria-label={theme === "dark" ? "切换亮色" : "切换暗色"}
            title={theme === "dark" ? "切换亮色" : "切换暗色"}
          >
            {theme === "dark" ? (
              <IconThemeSun size={17} />
            ) : (
              <IconThemeMoon size={17} />
            )}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-icon-only btn-delete titlebar-clear-all"
            onClick={handleOpenClearAll}
            disabled={dayTodos.length === 0}
            aria-label={
              dayTodos.length > 0 ? "删除当日全部待办" : "当日暂无待办，无法删除"
            }
            title={
              dayTodos.length > 0 ? "删除当日全部待办" : "当日暂无待办，无法删除"
            }
          >
            <IconTrash size={17} />
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-icon-only dock-toggle"
            onClick={() => void handleEnterMiniMode()}
            disabled={!canEnterMiniMode}
            aria-label={
              canEnterMiniMode
                ? "进入顶部迷你模式"
                : "暂无未完成待办，无法进入顶部迷你模式"
            }
            title={canEnterMiniMode ? "进入顶部迷你模式" : "暂无未完成待办"}
          >
            <IconDockTop size={17} />
          </button>
          <WindowControls />
        </div>
      </header>

      <main ref={appBodyRef} className="app-body">
        <div
          className={`app-content ${
            mainView === "statistics" ? "is-statistics-view" : ""
          }`}
        >
          {mainView === "statistics" ? (
            <StatisticsCenter
              todos={allTodos}
              anchorDate={selectedDate}
              period={statisticsPeriod}
              onPeriodChange={setStatisticsPeriod}
              onAnchorDateChange={setSelectedDate}
              onSelectDate={(date) => {
                setSelectedDate(date);
                setMainView("todos");
                appBodyRef.current?.scrollTo({ top: 0, behavior: "smooth" });
              }}
            />
          ) : subtaskEditorTarget ? (
            <TodoEditorForm
              key={`${subtaskEditorTarget.todoId}-${
                subtaskEditorTarget.mode === "edit"
                  ? subtaskEditorTarget.subtaskId
                  : subtaskEditorTarget.parentSubtaskId ?? "root"
              }`}
              initialDraft={getSubtaskEditorDraft(
                subtaskEditorTarget,
                dayTodos,
                selectedDate,
              )}
              title={subtaskEditorTarget.mode === "edit" ? "编辑子待办" : "新增子待办"}
              titleIcon={
                subtaskEditorTarget.mode === "edit" ? (
                  <IconPencil size={18} />
                ) : (
                  <IconPlus size={18} />
                )
              }
              submitLabel={
                subtaskEditorTarget.mode === "edit" ? "保存修改" : "添加子待办"
              }
              className="todo-form card"
              autoFocus
              onSubmit={handleSubmitSubtask}
              onCancel={() => setSubtaskEditorTarget(null)}
              todoDateSummaries={todoDateSummaries}
            />
          ) : editingTodo ? (
            <TodoEditorForm
              key={editingTodo.id}
              initialDraft={{
                title: editingTodo.title,
                date: editingTodo.date,
                taskTime: formatClockTime(editingTodo.createdAt),
                urgency: editingTodo.urgency,
                plannedSeconds:
                  editingTodo.plannedSeconds > 0
                    ? editingTodo.plannedSeconds
                    : 25 * 60,
                countdownEnabled: editingTodo.countdownEnabled,
                reminderEnabled: editingTodo.reminderEnabled,
                reminderTime: editingTodo.reminderTime,
                recordTimeEnabled: editingTodo.recordTimeEnabled,
                recurrence: editingTodo.recurrence,
                recurrenceEditScope: "series",
              }}
              title="编辑待办"
              titleIcon={<IconPencil size={18} />}
              submitLabel="保存修改"
              className="todo-form card"
              autoFocus
              onSubmit={handleSubmitEdit}
              onCancel={() => setEditingTodoId(null)}
              todoDateSummaries={todoDateSummaries}
            />
          ) : (
            <TodoForm
              onAdd={addTodo}
              open={todoFormOpen}
              selectedDate={selectedDate}
              todoDateSummaries={todoDateSummaries}
              onOpenChange={handleOpenNewTodo}
              templates={templates}
              templateNotice={templateNotice}
              onAddTemplate={addTemplate}
              onRenameTemplate={renameTemplate}
              onRemoveTemplate={removeTemplate}
              onMoveTemplate={moveTemplate}
            />
          )}

          {mainView === "todos" && !showingEditor && (
            <>
              <section
                className={`todo-list ${
                  draggingTodoId != null ? "is-dragging" : ""
                }`}
              >
                {dayTodos.length === 0 ? (
                  <div className="empty-state card">
                    <img
                      src="/logo.png"
                      alt=""
                      className="empty-state__logo"
                      draggable={false}
                    />
                    <h2>这一天还没有待办</h2>
                    <p>
                      点击上方「新建待办」，设置紧急程度，按需开启倒计时。
                    </p>
                  </div>
                ) : (
                  dayTodos.map((todo) => (
                    <TodoItem
                      key={todo.id}
                      itemRef={setTodoItemRef(todo.id)}
                      todo={todo}
                      liveElapsed={getLiveElapsed(todo)}
                      remaining={getCountdownRemaining(todo)}
                      isHighlighted={highlightedTodoId === todo.id}
                      isDragging={draggingTodoId === todo.id}
                      onStart={() => startTiming(todo.id)}
                      onPause={() => pauseTiming(todo.id)}
                      onStop={() => stopTiming(todo.id)}
                      onToggle={() => toggleComplete(todo.id)}
                      onRemove={() => handleRemoveTodo(todo.id)}
                      onEdit={() => handleStartEdit(todo.id)}
                      onReset={() => {
                        setPendingDeleteTodoId(null);
                        setPendingDeleteSubtask(null);
                        setPendingResetTodoId(todo.id);
                      }}
                      onUpdateComment={(comment) =>
                        updateComment(todo.id, comment)
                      }
                      onAddSubtask={(parentSubtaskId) =>
                        handleStartAddSubtask(todo.id, parentSubtaskId)
                      }
                      onEditSubtask={(subtaskId) =>
                        handleStartEditSubtask(todo.id, subtaskId)
                      }
                      onSyncSubtask={(subtaskId) => {
                        setPendingDeleteTodoId(null);
                        setPendingDeleteSubtask(null);
                        setPendingSyncSubtask({ todoId: todo.id, subtaskId });
                      }}
                      onToggleSubtask={(subtaskId) =>
                        toggleSubtask(todo.id, subtaskId)
                      }
                      onRemoveSubtask={(subtaskId) =>
                        setPendingDeleteSubtask({ todoId: todo.id, subtaskId })
                      }
                      onReorderSubtask={(draggedSubtaskId, targetSubtaskId) =>
                        reorderSubtask(todo.id, draggedSubtaskId, targetSubtaskId)
                      }
                      onStartSubtask={(subtaskId) =>
                        startSubtaskTiming(todo.id, subtaskId)
                      }
                      onPauseSubtask={(subtaskId) =>
                        pauseSubtaskTiming(todo.id, subtaskId)
                      }
                      onStopSubtask={(subtaskId) =>
                        stopSubtaskTiming(todo.id, subtaskId)
                      }
                      onDragHandlePointerDown={handleTodoDragHandlePointerDown(
                        todo.id,
                      )}
                    />
                  ))
                )}
              </section>
            </>
          )}
        </div>
        {mainView === "todos" &&
          !showingEditor &&
          dayTodos.length > 0 &&
          hasBodyOverflow && (
          <button
            type="button"
            className="btn btn-ghost btn-icon-only todo-scroll-top"
            onClick={handleScrollToTop}
            aria-label="回到顶部"
            title="回到顶部"
          >
            <IconChevronUp size={18} />
          </button>
        )}
      </main>
      {deleteConfirmDialog}
      {resetConfirmDialog}
      {clearAllConfirmDialog}
      {syncConfirmDialog}
    </div>
  );
}

export default App;
