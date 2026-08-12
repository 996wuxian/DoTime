import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { MiniTodoBar } from "./components/MiniTodoBar";
import { DailyReview } from "./components/DailyReview";
import { GlobalSearch } from "./components/GlobalSearch";
import { PlanOverview, type PlanPeriod } from "./components/PlanOverview";
import { StatisticsCenter } from "./components/StatisticsCenter";
import { DataActions } from "./components/DataActions";
import { DateNavigator } from "./components/DateNavigator";
import { CalendarPopover } from "./components/CalendarPopover";
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
  IconChevronLeft,
  IconChevronRight,
  IconChevronUp,
  IconBookmark,
  IconCalendarEvent,
  IconChartBar,
  IconCheck,
  IconCircleCheck,
  IconClipboardText,
  IconClock,
  IconClockHour4,
  IconCode,
  IconClose,
  IconDownload,
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
import type { Todo, TodoCategoryDivider, TodoSubtask } from "./types";
import { URGENCY_LABELS } from "./types";
import { shiftDateKey } from "./utils/calendar";
import {
  MINI_SUBTASKS_CLOSED_EVENT,
  MINI_SUBTASKS_HOVER_EVENT,
  MINI_SUBTASKS_VISIBILITY_EVENT,
  buildMiniSubtasksGroup,
} from "./utils/miniSubtasks";
import { buildPinnedTodoPayload } from "./utils/pinnedTodo";
import { loadTheme, saveTheme, toggleTheme } from "./utils/theme";
import {
  formatClockTime,
  formatDateKey,
  formatDuration,
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
const APP_VERSION = "1.1.1";
const APP_DEVELOPMENT_DATE = "2026-07-24";

type ActivePinnedTodo = {
  slot: string;
  todoId: string;
};
const APP_AUTHOR = "996wuxian";
const APP_REPOSITORY_URL = "https://github.com/996wuxian/DoTime";
const APP_DOWNLOAD_URL = "https://github.com/996wuxian/DoTime/releases";

type TodoDragState = {
  pointerId: number;
  draggedId: string;
  startX: number;
  startY: number;
  offsetX: number;
  offsetY: number;
  active: boolean;
  longPressTimer: number;
};

type TodoDragPreview = {
  x: number;
  y: number;
  width: number;
  height: number;
  html: string;
};

type TodoDropTarget = {
  targetId: string;
  targetType: "todo" | "category";
  position: "before" | "after";
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

type BatchConfirmAction = "delete";

type CompletionUndo = {
  todoId: string;
  title: string;
};

type CategoryInsertTarget = {
  beforeTodoId: string;
  afterTodoId: string;
};

type TodoTimelineItem =
  | { type: "todo"; todo: Todo }
  | { type: "category"; divider: TodoCategoryDivider };

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
  if (target == null) return createDefaultTodoDraft(selectedDate);
  const todo = todos.find((item) => item.id === target.todoId);
  if (target?.mode !== "edit") {
    const parent =
      todo == null
        ? null
        : target.parentSubtaskId == null
          ? todo
          : findTodoSubtask(todo.subtasks, target.parentSubtaskId);
    if (parent == null) return createDefaultTodoDraft(selectedDate);

    const draft = createDefaultTodoDraft(selectedDate);
    const countdownEnabled = parent.countdownEnabled;
    return {
      ...draft,
      urgency: parent.urgency,
      plannedSeconds: countdownEnabled
        ? Math.max(
            60,
            parent.plannedSeconds > 0 ? parent.plannedSeconds : draft.plannedSeconds,
          )
        : draft.plannedSeconds,
      countdownEnabled,
      recordTimeEnabled: countdownEnabled ? true : parent.recordTimeEnabled,
    };
  }

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
    images: [],
  };
}

function FavoriteTodoCard({
  todo,
  liveElapsed,
  onSelect,
  onRemoveFavorite,
}: {
  todo: Todo;
  liveElapsed: number;
  onSelect: () => void;
  onRemoveFavorite: () => void;
}) {
  const timeTrackingEnabled = todo.countdownEnabled || todo.recordTimeEnabled;
  const comment = todo.comment?.trim() ?? "";

  return (
    <div
      className={[
        "favorite-todo-card",
        "todo-item",
        "card",
        todo.countdownEnabled ? "has-countdown" : "",
        todo.completed ? "is-completed" : "",
        todo.isTiming ? "is-timing" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div
        role="button"
        tabIndex={0}
        className="favorite-todo-card__content"
        onClick={onSelect}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          onSelect();
        }}
      >
        <div className="todo-item__title-row">
          <div className="favorite-todo-card__title-main">
            <h3 className="todo-item__title">{todo.title}</h3>
            <span className={`badge badge--${todo.urgency}`}>
              {URGENCY_LABELS[todo.urgency]}
            </span>
            {!todo.completed && (
              <span
                className={`status-badge status-badge--${
                  todo.isTiming ? "active" : "idle"
                }`}
              >
                {todo.isTiming ? "进行中" : "待开始"}
              </span>
            )}
          </div>
          <button
            type="button"
            className="favorite-todo-card__remove"
            onClick={(event) => {
              event.stopPropagation();
              onRemoveFavorite();
            }}
            aria-label={`取消收藏 ${todo.title}`}
            title="取消收藏"
          >
            <IconBookmark size={16} />
          </button>
        </div>
        <div className="todo-item__meta">
          <span className="meta-item">
            <IconClock size={13} />
            {formatDisplayDate(todo.date)} {formatClockTime(todo.createdAt)}
          </span>
          {todo.countdownEnabled && (
            <span className="meta-item">
              <IconClock size={13} />
              计划 {formatDuration(todo.plannedSeconds)}
            </span>
          )}
          {timeTrackingEnabled && (liveElapsed > 0 || todo.isTiming) && (
            <span className="meta-item meta-elapsed">
              <IconClockHour4 size={13} />
              已用 {formatDuration(liveElapsed)}
            </span>
          )}
        </div>
        {comment && (
          <div className="favorite-todo-card__comment">{comment}</div>
        )}
      </div>
    </div>
  );
}

function TodoCategoryDividerRow({
  divider,
  dropPosition,
  onRename,
  onRemove,
}: {
  divider: TodoCategoryDivider;
  dropPosition?: "before" | "after" | null;
  onRename: (title: string) => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(divider.title);

  useEffect(() => {
    setDraft(divider.title);
  }, [divider.title]);

  const submit = () => {
    const title = draft.trim();
    if (!title) return;
    onRename(title);
    setEditing(false);
  };

  return (
    <div
      className={[
        "todo-category-row",
        dropPosition ? `is-drop-${dropPosition}` : "",
      ]
        .filter(Boolean)
        .join(" ")}
      data-category-id={divider.id}
    >
      <div className="todo-category-row__line" aria-hidden />
      {editing ? (
        <form
          className="todo-category-row__form"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setDraft(divider.title);
                setEditing(false);
              }
            }}
            maxLength={24}
            autoFocus
            aria-label="分类名"
          />
          <button type="submit" aria-label="保存分类名" title="保存">
            <IconCheck size={13} />
          </button>
          <button
            type="button"
            onClick={() => {
              setDraft(divider.title);
              setEditing(false);
            }}
            aria-label="取消编辑分类名"
            title="取消"
          >
            <IconClose size={13} />
          </button>
        </form>
      ) : (
        <div className="todo-category-row__label">
          <button type="button" onClick={() => setEditing(true)}>
            {divider.title}
          </button>
          <button
            type="button"
            className="todo-category-row__delete"
            onClick={onRemove}
            aria-label={`删除分类 ${divider.title}`}
            title="删除分类"
          >
            <IconTrash size={13} />
          </button>
        </div>
      )}
      <div className="todo-category-row__line" aria-hidden />
    </div>
  );
}

function TodoCategoryInsertRow({
  active,
  draft,
  onStart,
  onDraftChange,
  onSubmit,
  onCancel,
}: {
  active: boolean;
  draft: string;
  onStart: () => void;
  onDraftChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  if (!active) {
    return (
      <div className="todo-category-insert">
        <button
          type="button"
          className="todo-category-insert__button"
          onClick={onStart}
          aria-label="在这里添加分类"
          title="添加分类"
        >
          <IconPlus size={14} />
        </button>
      </div>
    );
  }

  return (
    <form
      className="todo-category-input"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <input
        value={draft}
        onChange={(event) => onDraftChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") onCancel();
        }}
        placeholder="分类名"
        maxLength={24}
        autoFocus
        aria-label="分类名"
      />
      <button type="submit" aria-label="保存分类" title="保存">
        <IconCheck size={13} />
      </button>
      <button type="button" onClick={onCancel} aria-label="取消添加分类" title="取消">
        <IconClose size={13} />
      </button>
    </form>
  );
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

async function showPinnedTodoWindow(todo: Todo) {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string>("show_pinned_todo_window", {
    pinnedTodo: JSON.stringify(buildPinnedTodoPayload(todo)),
  });
}

async function removePinnedTodoWindow(slot: string) {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("remove_pinned_todo", { slot });
}

async function getActivePinnedTodos() {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<ActivePinnedTodo[]>("get_active_pinned_todos");
}

async function openExternalUrl(url: string) {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("open_external_url", { url }).catch((error) => {
    console.error("failed to open external url", error);
  });
}

async function cleanupStoredTodoImages(todos: readonly Todo[]) {
  const { cleanupTodoImages } = await import("./utils/todoImages");
  return cleanupTodoImages(todos);
}

async function showMiniSubtasksWindow(todo: Todo) {
  const { invoke } = await import("@tauri-apps/api/core");
  const group = buildMiniSubtasksGroup(todo);
  if (group == null) return;

  await invoke("show_mini_subtasks_window", {
    subtasksGroup: JSON.stringify(group),
  }).catch((error) => {
    console.error("failed to show mini subtasks window", error);
  });
}

async function closeMiniSubtasksWindow() {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("close_mini_subtasks_window").catch((error) => {
    console.error("failed to close mini subtasks window", error);
  });
}

function App() {
  const [selectedDate, setSelectedDate] = useState(() => formatDateKey());
  const [todoFormOpen, setTodoFormOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [editingTodoId, setEditingTodoId] = useState<string | null>(null);
  const [subtaskEditorTarget, setSubtaskEditorTarget] =
    useState<SubtaskEditorTarget | null>(null);
  const [theme, setTheme] = useState(() => loadTheme());
  const [miniMode, setMiniMode] = useState(false);
  const [miniIndex, setMiniIndex] = useState(0);
  const [miniAutoHideEnabled, setMiniAutoHideEnabled] = useState(false);
  const [miniAutoHideRevealed, setMiniAutoHideRevealed] = useState(true);
  const [miniSubtasksOpen, setMiniSubtasksOpen] = useState(false);
  const [miniSubtasksHovered, setMiniSubtasksHovered] = useState(false);
  const miniSubtasksHoverLastAtRef = useRef(0);
  const [pinnedTodoSlots, setPinnedTodoSlots] = useState<Map<string, string>>(
    () => new Map(),
  );
  const [miniOpacity, setMiniOpacity] = useState(() => loadMiniOpacity());
  const [mainView, setMainView] = useState<
    "todos" | "plan" | "statistics" | "review"
  >("todos");
  const [planPeriod, setPlanPeriod] = useState<PlanPeriod>("week");
  const [statisticsPeriod, setStatisticsPeriod] =
    useState<StatisticsPeriod>("week");
  const [favoritesOpen, setFavoritesOpen] = useState(false);
  const [batchMode, setBatchMode] = useState(false);
  const [batchMenuOpen, setBatchMenuOpen] = useState(false);
  const [batchMoveCalendarOpen, setBatchMoveCalendarOpen] = useState(false);
  const [batchMoveDate, setBatchMoveDate] = useState(selectedDate);
  const [selectedTodoIds, setSelectedTodoIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [pendingBatchAction, setPendingBatchAction] =
    useState<BatchConfirmAction | null>(null);
  const [completionUndo, setCompletionUndo] = useState<CompletionUndo | null>(
    null,
  );
  const [categoryInsertTarget, setCategoryInsertTarget] =
    useState<CategoryInsertTarget | null>(null);
  const [categoryDraft, setCategoryDraft] = useState("");
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
  const favoritesMenuRef = useRef<HTMLDivElement | null>(null);
  const confirmDeleteButtonRef = useRef<HTMLButtonElement | null>(null);
  const todoItemRefs = useRef(new Map<string, HTMLElement>());
  const highlightTimerRef = useRef<number | null>(null);
  const dragStateRef = useRef<TodoDragState | null>(null);
  const todoDropTargetRef = useRef<TodoDropTarget | null>(null);
  const [draggingTodoId, setDraggingTodoId] = useState<string | null>(null);
  const [todoDragPreview, setTodoDragPreview] =
    useState<TodoDragPreview | null>(null);
  const [todoDropTarget, setTodoDropTarget] = useState<TodoDropTarget | null>(
    null,
  );
  const {
    allTodos,
    dayTodos,
    dayCategoryDividers,
    stats,
    todoDateSummaries,
    addTodo,
    removeTodo,
    clearDayTodos,
    reorderTodo,
    addCategoryDividerBetween,
    updateCategoryDivider,
    removeCategoryDivider,
    toggleComplete,
    updateTodo,
    updateComment,
    updateTodoImages,
    toggleFavorite,
    clearFavorites,
    completeTodos,
    moveTodos,
    removeSelectedTodos,
    clearSelectedFavorites,
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

  const refreshPinnedTodoSlots = () => {
    void getActivePinnedTodos()
      .then((items) => {
        setPinnedTodoSlots(
          new Map(items.map((item) => [item.todoId, item.slot])),
        );
      })
      .catch((error) => {
        console.error("failed to load pinned todos", error);
      });
  };

  const togglePinnedTodoWindow = async (todo: Todo) => {
    const slot = pinnedTodoSlots.get(todo.id);

    try {
      if (slot != null) {
        await removePinnedTodoWindow(slot);
        setPinnedTodoSlots((current) => {
          const next = new Map(current);
          next.delete(todo.id);
          return next;
        });
      } else {
        const nextSlot = await showPinnedTodoWindow(todo);
        setPinnedTodoSlots((current) => {
          const next = new Map(current);
          next.set(todo.id, nextSlot);
          return next;
        });
      }
      refreshPinnedTodoSlots();
    } catch (error) {
      console.error("failed to toggle pinned todo window", error);
      window.alert(`固定待办窗口操作失败：${String(error)}`);
      refreshPinnedTodoSlots();
    }
  };

  useEffect(() => {
    saveTheme(theme);
  }, [theme]);

  useEffect(() => {
    refreshPinnedTodoSlots();
  }, []);

  useEffect(() => {
    if (!favoritesOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (favoritesMenuRef.current?.contains(target)) return;
      setFavoritesOpen(false);
    };

    window.addEventListener("pointerdown", handlePointerDown, true);
    return () =>
      window.removeEventListener("pointerdown", handlePointerDown, true);
  }, [favoritesOpen]);

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
    if (!miniMode) {
      setMiniSubtasksOpen(false);
      setMiniSubtasksHovered(false);
      void closeMiniSubtasksWindow();
    }
  }, [miniMode]);

  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | undefined;

    void import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen(MINI_SUBTASKS_CLOSED_EVENT, () => {
          if (!disposed) {
            setMiniSubtasksOpen(false);
            setMiniSubtasksHovered(false);
          }
        }),
      )
      .then((unlisten) => {
        if (disposed) {
          unlisten();
          return;
        }
        cleanup = unlisten;
      })
      .catch(() => {
        cleanup = undefined;
      });

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, []);

  useEffect(() => {
    document.body.classList.toggle("is-mini-mode", miniMode);
    return () => document.body.classList.remove("is-mini-mode");
  }, [miniMode]);

  useEffect(() => {
    let disposed = false;
    let cleanups: Array<() => void> = [];

    void import("@tauri-apps/api/event")
      .then(async ({ listen }) => {
        const refresh = () => {
          if (!disposed) refreshPinnedTodoSlots();
        };
        const unlistenAppData = await listen("dotime-app-data-updated", refresh);
        const unlistenPinnedTodos = await listen(
          "dotime-pinned-todos-updated",
          refresh,
        );
        if (disposed) {
          unlistenAppData();
          unlistenPinnedTodos();
          return;
        }
        cleanups = [unlistenAppData, unlistenPinnedTodos];
      })
      .catch(() => {
        cleanups = [];
      });

    return () => {
      disposed = true;
      cleanups.forEach((cleanup) => cleanup());
    };
  }, []);

  useEffect(() => {
    if (!aboutOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAboutOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [aboutOpen]);

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
  const favoriteTodos = allTodos
    .filter((todo) => todo.favorite)
    .sort(
      (a, b) =>
        b.date.localeCompare(a.date) ||
        a.sortOrder - b.sortOrder ||
        b.createdAt - a.createdAt,
    );
  const selectedCount = selectedTodoIds.size;
  const selectedFavoriteCount = dayTodos.filter(
    (todo) => selectedTodoIds.has(todo.id) && todo.favorite,
  ).length;
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
  const batchDeleteDescription =
    selectedCount > 0
      ? `将删除已选择的 ${selectedCount} 个待办（包含子待办和计时记录），此操作不可撤销。`
      : "请先选择要删除的待办。";
  const dayTimelineItems = useMemo<TodoTimelineItem[]>(
    () =>
      [
        ...dayTodos.map((todo) => ({ type: "todo" as const, todo })),
        ...dayCategoryDividers.map((divider) => ({
          type: "category" as const,
          divider,
        })),
      ].sort((a, b) => {
        const sortA = a.type === "todo" ? a.todo.sortOrder : a.divider.sortOrder;
        const sortB = b.type === "todo" ? b.todo.sortOrder : b.divider.sortOrder;
        if (sortA !== sortB) return sortA - sortB;
        const createdA = a.type === "todo" ? a.todo.createdAt : a.divider.createdAt;
        const createdB = b.type === "todo" ? b.todo.createdAt : b.divider.createdAt;
        return createdA - createdB;
      }),
    [dayCategoryDividers, dayTodos],
  );

  useEffect(() => {
    if (miniIndex !== activeMiniIndex) setMiniIndex(activeMiniIndex);
  }, [activeMiniIndex, miniIndex]);

  useEffect(() => {
    if (!miniMode || !miniSubtasksOpen || miniTodo == null) return;
    if ((miniTodo.subtasks ?? []).length === 0) {
      setMiniSubtasksOpen(false);
      void closeMiniSubtasksWindow();
      return;
    }
    void showMiniSubtasksWindow(miniTodo);
  }, [miniMode, miniSubtasksOpen, miniTodo]);

  useEffect(() => {
    if (!miniMode || !miniSubtasksOpen) return;
    const visible = !miniAutoHideEnabled || miniAutoHideRevealed;
    let cancelled = false;

    void (async () => {
      const { emit } = await import("@tauri-apps/api/event");
      if (cancelled) return;
      await emit(MINI_SUBTASKS_VISIBILITY_EVENT, { visible });
    })();

    return () => {
      cancelled = true;
    };
  }, [miniMode, miniSubtasksOpen, miniAutoHideEnabled, miniAutoHideRevealed]);

  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | undefined;

    void import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen<{ hovered: boolean }>(MINI_SUBTASKS_HOVER_EVENT, (event) => {
          if (disposed) return;
          const nextHovered = Boolean(event.payload?.hovered);
          miniSubtasksHoverLastAtRef.current = nextHovered ? Date.now() : 0;
          setMiniSubtasksHovered(nextHovered);
        }),
      )
      .then((unlisten) => {
        if (disposed) {
          unlisten();
          return;
        }
        cleanup = unlisten;
      })
      .catch(() => {
        cleanup = undefined;
      });

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, []);

  useEffect(() => {
    if (!miniMode || !miniSubtasksOpen || !miniSubtasksHovered) return;
    const id = window.setInterval(() => {
      const lastHoveredAt = miniSubtasksHoverLastAtRef.current;
      if (lastHoveredAt === 0) return;
      if (Date.now() - lastHoveredAt > 900) {
        miniSubtasksHoverLastAtRef.current = 0;
        setMiniSubtasksHovered(false);
      }
    }, 300);

    return () => window.clearInterval(id);
  }, [miniMode, miniSubtasksOpen, miniSubtasksHovered]);

  useEffect(() => {
    if (miniMode && !canEnterMiniMode) void handleExitMiniMode();
  }, [canEnterMiniMode, miniMode]);

  useEffect(() => {
    if (
      !pendingDeleteTodoId &&
      !pendingResetTodoId &&
      !pendingClearAll &&
      pendingDeleteSubtask == null &&
      pendingSyncSubtask == null &&
      pendingBatchAction == null
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
    pendingBatchAction,
  ]);

  useEffect(() => {
    if (
      !pendingDeleteTodoId &&
      !pendingResetTodoId &&
      !pendingClearAll &&
      pendingDeleteSubtask == null &&
      pendingSyncSubtask == null &&
      pendingBatchAction == null
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
        setPendingBatchAction(null);
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
    pendingBatchAction,
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
    if (completionUndo == null) return;
    const timeoutId = window.setTimeout(() => setCompletionUndo(null), 5000);
    return () => window.clearTimeout(timeoutId);
  }, [completionUndo]);

  useEffect(() => {
    const dayTodoIds = new Set(dayTodos.map((todo) => todo.id));
    setSelectedTodoIds((current) => {
      const next = new Set([...current].filter((id) => dayTodoIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [dayTodos]);

  useEffect(() => {
    setBatchMoveDate(selectedDate);
  }, [selectedDate]);

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

  const handleToggleMiniSubtasks = () => {
    if (miniTodo == null || (miniTodo.subtasks ?? []).length === 0) return;
    setMiniSubtasksOpen((open) => {
      const nextOpen = !open;
      if (!nextOpen) {
        void closeMiniSubtasksWindow();
      } else {
        void showMiniSubtasksWindow(miniTodo);
      }
      return nextOpen;
    });
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
    todoDropTargetRef.current = null;
    setDraggingTodoId(null);
    setTodoDragPreview(null);
    setTodoDropTarget(null);
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
    setTodoDragPreview((current) =>
      current == null
        ? current
        : {
            ...current,
            x: event.clientX - dragState.offsetX,
            y: event.clientY - dragState.offsetY,
          },
    );

    const target = document.elementFromPoint(event.clientX, event.clientY);
    const targetItem = target?.closest<HTMLElement>(
      "[data-todo-id], [data-category-id]",
    );
    if (targetItem == null) {
      todoDropTargetRef.current = null;
      setTodoDropTarget(null);
      return;
    }

    const targetId =
      targetItem?.dataset.todoId ?? targetItem?.dataset.categoryId;
    const targetType: TodoDropTarget["targetType"] = targetItem?.dataset.todoId
      ? "todo"
      : "category";
    if (!targetId || targetId === dragState.draggedId) {
      todoDropTargetRef.current = null;
      setTodoDropTarget(null);
      return;
    }

    const targetRect = targetItem.getBoundingClientRect();
    const relativeY = (event.clientY - targetRect.top) / targetRect.height;
    const nextDropTarget: TodoDropTarget = {
      targetId,
      targetType,
      position: relativeY >= 0.5 ? "after" : "before",
    };
    todoDropTargetRef.current = nextDropTarget;
    setTodoDropTarget(nextDropTarget);
  };

  const handleTodoDragEnd = (event: globalThis.PointerEvent) => {
    const dragState = dragStateRef.current;
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    const dropTarget = todoDropTargetRef.current;
    if (dragState.active && dropTarget != null) {
      reorderTodo(
        dragState.draggedId,
        dropTarget.targetId,
        dropTarget.position,
        dropTarget.targetType,
      );
    }
    finishTodoDrag();
  };

  const handleTodoDragHandlePointerDown =
    (id: string) => (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (batchMode) return;
      if (event.button !== 0) return;

      event.preventDefault();
      event.stopPropagation();

      finishTodoDrag();

      const node = todoItemRefs.current.get(id);
      const rect = node?.getBoundingClientRect();
      const dragState: TodoDragState = {
        pointerId: event.pointerId,
        draggedId: id,
        startX: event.clientX,
        startY: event.clientY,
        offsetX: rect == null ? 0 : event.clientX - rect.left,
        offsetY: rect == null ? 0 : event.clientY - rect.top,
        active: false,
        longPressTimer: window.setTimeout(() => {
          const current = dragStateRef.current;
          if (!current || current.pointerId !== event.pointerId) return;
          current.active = true;
          const previewNode = todoItemRefs.current.get(id);
          const previewRect = previewNode?.getBoundingClientRect();
          setDraggingTodoId(id);
          setTodoDragPreview({
            x: event.clientX - current.offsetX,
            y: event.clientY - current.offsetY,
            width: previewRect?.width ?? rect?.width ?? 360,
            height: previewRect?.height ?? rect?.height ?? 80,
            html: previewNode?.outerHTML ?? "",
          });
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

  const handleToggleBatchMenu = () => {
    setBatchMenuOpen((open) => !open);
    setBatchMoveCalendarOpen(false);
    setBatchMode(true);
    setMainView("todos");
    setTodoFormOpen(false);
    setEditingTodoId(null);
    setSubtaskEditorTarget(null);
  };

  const handleExitBatchMode = () => {
    setBatchMode(false);
    setBatchMenuOpen(false);
    setBatchMoveCalendarOpen(false);
    setPendingBatchAction(null);
    setSelectedTodoIds(new Set());
  };

  const handleToggleBatchSelect = (id: string) => {
    setSelectedTodoIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleSelectAllDayTodos = () => {
    setSelectedTodoIds(new Set(dayTodos.map((todo) => todo.id)));
  };

  const handleClearBatchSelection = () => {
    setSelectedTodoIds(new Set());
  };

  const handleBatchComplete = () => {
    if (selectedCount === 0) return;
    completeTodos(selectedTodoIds);
    handleExitBatchMode();
  };

  const handleBatchMove = () => {
    if (selectedCount === 0 || !batchMoveDate) return;
    moveTodos(selectedTodoIds, batchMoveDate);
    setSelectedDate(batchMoveDate);
    handleExitBatchMode();
  };

  const handleBatchMoveQuick = (days: number) => {
    if (selectedCount === 0) return;
    const targetDate = shiftDateKey(selectedDate, days);
    moveTodos(selectedTodoIds, targetDate);
    setSelectedDate(targetDate);
    handleExitBatchMode();
  };

  const handleBatchClearFavorites = () => {
    if (selectedCount === 0) return;
    clearSelectedFavorites(selectedTodoIds);
  };

  const handleConfirmBatchDelete = () => {
    if (selectedCount === 0) {
      setPendingBatchAction(null);
      return;
    }
    removeSelectedTodos(selectedTodoIds);
    handleExitBatchMode();
  };

  const handleSelectFavoriteTodo = (todo: Todo) => {
    setFavoritesOpen(false);
    setSelectedDate(todo.date);
    setMainView("todos");
    setTodoFormOpen(false);
    setEditingTodoId(null);
    setSubtaskEditorTarget(null);
    scrollTodoIntoView(todo.id);
    flashTodo(todo.id);
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

  const handleToggleTodoCompletion = (todo: Todo) => {
    toggleComplete(todo.id);
    setCompletionUndo(
      !todo.completed && todo.recurrence == null
        ? { todoId: todo.id, title: todo.title }
        : null,
    );
  };

  const handleSubmitCategoryInsert = () => {
    if (categoryInsertTarget == null) return;
    const title = categoryDraft.trim();
    if (!title) return;
    addCategoryDividerBetween(
      selectedDate,
      title,
      categoryInsertTarget.beforeTodoId,
      categoryInsertTarget.afterTodoId,
    );
    setCategoryDraft("");
    setCategoryInsertTarget(null);
  };

  const handleCancelCategoryInsert = () => {
    setCategoryDraft("");
    setCategoryInsertTarget(null);
  };

  const handleUndoCompletion = () => {
    if (completionUndo == null) return;
    toggleComplete(completionUndo.todoId);
    setCompletionUndo(null);
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

  const batchDeleteConfirmDialog = pendingBatchAction === "delete" ? (
    <div
      className="confirm-overlay"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) setPendingBatchAction(null);
      }}
    >
      <section
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="batch-delete-confirm-title"
        aria-describedby="batch-delete-confirm-desc"
      >
        <div className="confirm-dialog__icon" aria-hidden>
          <IconTrash size={20} />
        </div>
        <div className="confirm-dialog__content">
          <div className="confirm-dialog__header">
            <h2 id="batch-delete-confirm-title">删除选中的待办？</h2>
            <button
              type="button"
              className="btn btn-ghost btn-icon-only confirm-dialog__close"
              onClick={() => setPendingBatchAction(null)}
              aria-label="取消批量删除"
              title="取消批量删除"
            >
              <IconClose size={16} />
            </button>
          </div>
          <p id="batch-delete-confirm-desc">{batchDeleteDescription}</p>
          <div className="confirm-dialog__actions">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setPendingBatchAction(null)}
            >
              取消
            </button>
            <button
              ref={confirmDeleteButtonRef}
              type="button"
              className="btn btn-danger btn-sm"
              onClick={handleConfirmBatchDelete}
              disabled={selectedCount === 0}
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

  const aboutDialog = aboutOpen ? (
    <div
      className="confirm-overlay"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) setAboutOpen(false);
      }}
    >
      <section
        className="confirm-dialog about-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-dialog-title"
      >
        <div className="confirm-dialog__icon about-dialog__icon" aria-hidden>
          <img src="/logo.png" alt="" draggable={false} />
        </div>
        <div className="confirm-dialog__content">
          <div className="confirm-dialog__header">
            <div>
              <h2 id="about-dialog-title">doTime</h2>
              <p className="about-dialog__summary">
                本地优先的待办、倒计时与耗时追踪工具
              </p>
            </div>
            <button
              type="button"
              className="btn btn-ghost btn-icon-only confirm-dialog__close"
              onClick={() => setAboutOpen(false)}
              aria-label="关闭关于 doTime"
              title="关闭"
            >
              <IconClose size={16} />
            </button>
          </div>

          <dl className="about-dialog__list">
            <div>
              <dt>版本号</dt>
              <dd>v{APP_VERSION}</dd>
            </div>
            <div>
              <dt>开发日期</dt>
              <dd>{APP_DEVELOPMENT_DATE}</dd>
            </div>
            <div>
              <dt>作者</dt>
              <dd>{APP_AUTHOR}</dd>
            </div>
            <div>
              <dt>仓库地址</dt>
              <dd>
                <button
                  type="button"
                  className="about-dialog__link"
                  onClick={() => void openExternalUrl(APP_REPOSITORY_URL)}
                >
                  {APP_REPOSITORY_URL}
                </button>
              </dd>
            </div>
            <div>
              <dt>下载地址</dt>
              <dd>
                <button
                  type="button"
                  className="about-dialog__link"
                  onClick={() => void openExternalUrl(APP_DOWNLOAD_URL)}
                >
                  {APP_DOWNLOAD_URL}
                </button>
              </dd>
            </div>
          </dl>

          <div className="confirm-dialog__actions">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => void openExternalUrl(APP_REPOSITORY_URL)}
            >
              <IconCode size={14} />
              仓库
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => void openExternalUrl(APP_DOWNLOAD_URL)}
            >
              <IconDownload size={14} />
              下载
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
          subtasksOpen={miniSubtasksOpen}
          subtasksHovered={miniSubtasksHovered}
          onToggleAutoHide={() => void handleToggleMiniAutoHide()}
          onReveal={() => void handleRevealMiniMode()}
          onHide={() => void handleHideMiniMode()}
          onToggleSubtasks={() => void handleToggleMiniSubtasks()}
          onStart={() => {
            if (miniTodo) startTiming(miniTodo.id);
          }}
          onPause={() => {
            if (miniTodo) pauseTiming(miniTodo.id);
          }}
          onToggle={() => {
            if (miniTodo) handleToggleTodoCompletion(miniTodo);
          }}
          onRemove={() => {
            if (miniTodo) handleRemoveTodo(miniTodo.id);
          }}
          onRestore={() => void handleExitMiniMode()}
        />
        {deleteConfirmDialog}
        {batchDeleteConfirmDialog}
        {resetConfirmDialog}
        {clearAllConfirmDialog}
        {syncConfirmDialog}
        {aboutDialog}
      </div>
    );
  }

  return (
    <div className="app">
      <header
        className="titlebar"
        data-tauri-drag-region
      >
        <div
          className="brand"
          data-tauri-drag-region
        >
          <img
            src="/logo.png"
            alt="doTime"
            className="app-logo"
            draggable={false}
            data-tauri-drag-region
          />
          <button
            type="button"
            className="brand__title-button"
            onClick={() => setAboutOpen(true)}
            aria-label="查看 doTime 关于信息"
            title="关于 doTime"
          >
            <h1 className="brand__title">doTime</h1>
          </button>
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
          <section
            className="stats-row"
            aria-label="日期统计"
            data-tauri-drag-region
          >
            <div className="stat-card" title="待办" data-tauri-drag-region>
              <span className="stat-card__icon">
                <IconListCheck size={14} />
              </span>
              <span className="stat-card__label">待办</span>
              <span className="stat-card__value">{stats.total}</span>
            </div>
            <div className="stat-card" title="已完成" data-tauri-drag-region>
              <span className="stat-card__icon stat-card__icon--success">
                <IconCircleCheck size={14} />
              </span>
              <span className="stat-card__label">已完成</span>
              <span className="stat-card__value">{stats.done}</span>
            </div>
            <div className="stat-card" title="计时中" data-tauri-drag-region>
              <span className="stat-card__icon stat-card__icon--primary">
                <IconClockHour4 size={14} />
              </span>
              <span className="stat-card__label">计时中</span>
              <span className="stat-card__value">{stats.timing}</span>
            </div>
            <div className="stat-card" title="总耗时" data-tauri-drag-region>
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
            onCleanupImages={() => cleanupStoredTodoImages(allTodos)}
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
            className={`btn btn-ghost btn-icon-only plan-toggle ${
              mainView === "plan" ? "is-active" : ""
            }`}
            onClick={() => {
              setMainView((view) => (view === "plan" ? "todos" : "plan"));
              setTodoFormOpen(false);
              setEditingTodoId(null);
              setSubtaskEditorTarget(null);
            }}
            aria-label={mainView === "plan" ? "返回待办" : "查看计划视图"}
            aria-pressed={mainView === "plan"}
            title={mainView === "plan" ? "返回待办" : "计划视图"}
          >
            <IconCalendarEvent size={17} />
          </button>
          <button
            type="button"
            className={`btn btn-ghost btn-icon-only review-toggle ${
              mainView === "review" ? "is-active" : ""
            }`}
            onClick={() => {
              setMainView((view) => (view === "review" ? "todos" : "review"));
              setTodoFormOpen(false);
              setEditingTodoId(null);
              setSubtaskEditorTarget(null);
            }}
            aria-label={mainView === "review" ? "返回待办" : "查看日复盘"}
            aria-pressed={mainView === "review"}
            title={mainView === "review" ? "返回待办" : "日复盘"}
          >
            <IconClipboardText size={17} />
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
          <div className="favorites-menu" ref={favoritesMenuRef}>
            <button
              type="button"
              className={`btn btn-ghost btn-icon-only favorites-menu__toggle ${
                favoritesOpen ? "is-active" : ""
              }`}
              onClick={() => setFavoritesOpen((open) => !open)}
              aria-label="查看收藏待办"
              aria-expanded={favoritesOpen}
              title="收藏待办"
            >
              <IconBookmark size={17} />
            </button>
            {favoritesOpen && (
              <section className="favorites-menu__panel" aria-label="收藏待办">
                <div className="favorites-menu__header">
                  <div>
                    <strong>收藏待办</strong>
                    <span>{favoriteTodos.length} 个</span>
                  </div>
                  <button
                    type="button"
                    className="favorites-menu__clear"
                    onClick={clearFavorites}
                    disabled={favoriteTodos.length === 0}
                  >
                    取消全部收藏
                  </button>
                </div>
                <div className="favorites-menu__list">
                  {favoriteTodos.length === 0 ? (
                    <div className="favorites-menu__empty">
                      暂无收藏待办
                    </div>
                  ) : (
                    favoriteTodos.map((todo) => (
                      <FavoriteTodoCard
                        key={todo.id}
                        todo={todo}
                        liveElapsed={getLiveElapsed(todo)}
                        onSelect={() => handleSelectFavoriteTodo(todo)}
                        onRemoveFavorite={() => toggleFavorite(todo.id)}
                      />
                    ))
                  )}
                </div>
              </section>
            )}
          </div>
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
            mainView === "statistics"
              ? "is-statistics-view"
              : mainView === "plan"
                ? "is-plan-view"
                : mainView === "review"
                  ? "is-review-view"
                  : ""
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
          ) : mainView === "plan" ? (
            <PlanOverview
              todos={allTodos}
              anchorDate={selectedDate}
              period={planPeriod}
              onPeriodChange={setPlanPeriod}
              onAnchorDateChange={setSelectedDate}
              onSelectDate={(date) => {
                setSelectedDate(date);
                setMainView("todos");
                appBodyRef.current?.scrollTo({ top: 0, behavior: "smooth" });
              }}
            />
          ) : mainView === "review" ? (
            <DailyReview
              todos={allTodos}
              date={selectedDate}
              getLiveElapsed={getLiveElapsed}
              onSelectTodo={(todo) => {
                setSelectedDate(todo.date);
                setMainView("todos");
                setTodoFormOpen(false);
                setEditingTodoId(null);
                setSubtaskEditorTarget(null);
                scrollTodoIntoView(todo.id);
                flashTodo(todo.id);
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
              showImages={false}
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
                comment: editingTodo.comment ?? "",
                subtaskTitles: "",
                images: editingTodo.images ?? [],
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
              todoId={editingTodo.id}
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
                  dayTimelineItems.map((item, index) => {
                    const nextItem = dayTimelineItems[index + 1];
                    if (item.type === "category") {
                      return (
                        <TodoCategoryDividerRow
                          key={item.divider.id}
                          divider={item.divider}
                          dropPosition={
                            todoDropTarget?.targetType === "category" &&
                            todoDropTarget.targetId === item.divider.id
                              ? todoDropTarget.position
                              : null
                          }
                          onRename={(title) =>
                            updateCategoryDivider(item.divider.id, title)
                          }
                          onRemove={() => removeCategoryDivider(item.divider.id)}
                        />
                      );
                    }

                    const todo = item.todo;
                    const insertTarget =
                      nextItem?.type === "todo"
                        ? {
                            beforeTodoId: todo.id,
                            afterTodoId: nextItem.todo.id,
                          }
                        : null;
                    const insertActive =
                      insertTarget != null &&
                      categoryInsertTarget?.beforeTodoId ===
                        insertTarget.beforeTodoId &&
                      categoryInsertTarget.afterTodoId ===
                        insertTarget.afterTodoId;

                    return (
                      <div key={todo.id} className="todo-timeline-group">
                        <TodoItem
                          itemRef={setTodoItemRef(todo.id)}
                          todo={todo}
                          liveElapsed={getLiveElapsed(todo)}
                          remaining={getCountdownRemaining(todo)}
                          isHighlighted={highlightedTodoId === todo.id}
                          isDragging={draggingTodoId === todo.id}
                          dropPosition={
                            todoDropTarget?.targetType === "todo" &&
                            todoDropTarget.targetId === todo.id
                              ? todoDropTarget.position
                              : null
                          }
                          batchMode={batchMode}
                          isBatchSelected={selectedTodoIds.has(todo.id)}
                          isPinned={pinnedTodoSlots.has(todo.id)}
                          onStart={() => startTiming(todo.id)}
                          onPause={() => pauseTiming(todo.id)}
                          onStop={() => stopTiming(todo.id)}
                          onToggle={() => handleToggleTodoCompletion(todo)}
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
                          onUpdateImages={(images) =>
                            updateTodoImages(todo.id, images)
                          }
                          onToggleFavorite={() => toggleFavorite(todo.id)}
                          onPin={() => void togglePinnedTodoWindow(todo)}
                          onToggleBatchSelect={() =>
                            handleToggleBatchSelect(todo.id)
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
                            setPendingSyncSubtask({
                              todoId: todo.id,
                              subtaskId,
                            });
                          }}
                          onToggleSubtask={(subtaskId) =>
                            toggleSubtask(todo.id, subtaskId)
                          }
                          onRemoveSubtask={(subtaskId) =>
                            setPendingDeleteSubtask({
                              todoId: todo.id,
                              subtaskId,
                            })
                          }
                          onReorderSubtask={(draggedSubtaskId, targetSubtaskId) =>
                            reorderSubtask(
                              todo.id,
                              draggedSubtaskId,
                              targetSubtaskId,
                            )
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
                        {insertTarget && (
                          <TodoCategoryInsertRow
                            active={insertActive}
                            draft={categoryDraft}
                            onStart={() => {
                              setCategoryDraft("");
                              setCategoryInsertTarget(insertTarget);
                            }}
                            onDraftChange={setCategoryDraft}
                            onSubmit={handleSubmitCategoryInsert}
                            onCancel={handleCancelCategoryInsert}
                          />
                        )}
                      </div>
                    );
                  })
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
        {mainView === "todos" && !showingEditor && dayTodos.length > 0 && (
          <div
            className={`batch-actions ${batchMenuOpen ? "is-open" : ""} ${
              batchMode ? "is-active" : ""
            }`}
          >
            {batchMenuOpen && (
              <section className="batch-actions__panel" aria-label="批量操作">
                <div className="batch-actions__header">
                  <div>
                    <strong>批量操作</strong>
                    <span>
                      已选择 {selectedCount} / {dayTodos.length}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="btn btn-ghost btn-icon-only batch-actions__close"
                    onClick={handleExitBatchMode}
                    aria-label="退出批量操作"
                    title="退出批量操作"
                  >
                    <IconClose size={15} />
                  </button>
                </div>

                <div className="batch-actions__select-row">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={handleSelectAllDayTodos}
                    disabled={selectedCount === dayTodos.length}
                  >
                    全选
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={handleClearBatchSelection}
                    disabled={selectedCount === 0}
                  >
                    清空选择
                  </button>
                </div>

                <div className="batch-actions__date">
                  <span className="batch-actions__date-label">
                    <IconCalendarEvent size={14} />
                    移动到日期
                  </span>
                  <div className="batch-actions__date-nav">
                    <button
                      type="button"
                      className="btn btn-ghost btn-icon-only"
                      onClick={() =>
                        setBatchMoveDate((date) => shiftDateKey(date, -1))
                      }
                      aria-label="移动到前一天"
                      title="前一天"
                    >
                      <IconChevronLeft size={17} />
                    </button>
                    <button
                      type="button"
                      className="batch-actions__date-current"
                      onClick={() => setBatchMoveCalendarOpen((open) => !open)}
                      aria-label="选择移动日期"
                      aria-expanded={batchMoveCalendarOpen}
                      aria-haspopup="dialog"
                      title="选择移动日期"
                    >
                      <IconCalendarEvent size={14} />
                      <span>{formatDisplayDate(batchMoveDate)}</span>
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-icon-only"
                      onClick={() =>
                        setBatchMoveDate((date) => shiftDateKey(date, 1))
                      }
                      aria-label="移动到后一天"
                      title="后一天"
                    >
                      <IconChevronRight size={17} />
                    </button>
                    {batchMoveCalendarOpen && (
                      <CalendarPopover
                        value={batchMoveDate}
                        todoSummaries={todoDateSummaries}
                        onSelect={(date) => {
                          setBatchMoveDate(date);
                          setBatchMoveCalendarOpen(false);
                        }}
                      />
                    )}
                  </div>
                </div>

                <div className="batch-actions__commands">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => handleBatchMoveQuick(1)}
                    disabled={selectedCount === 0}
                  >
                    <IconCalendarEvent size={14} />
                    明天
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => handleBatchMoveQuick(7)}
                    disabled={selectedCount === 0}
                  >
                    <IconCalendarEvent size={14} />
                    下周
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={handleBatchComplete}
                    disabled={selectedCount === 0}
                  >
                    <IconCircleCheck size={14} />
                    批量完成
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={handleBatchMove}
                    disabled={selectedCount === 0 || !batchMoveDate}
                  >
                    <IconCalendarEvent size={14} />
                    移动日期
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={handleBatchClearFavorites}
                    disabled={selectedFavoriteCount === 0}
                  >
                    <IconBookmark size={14} />
                    取消收藏
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    onClick={() => setPendingBatchAction("delete")}
                    disabled={selectedCount === 0}
                  >
                    <IconTrash size={14} />
                    批量删除
                  </button>
                </div>
              </section>
            )}
            <button
              type="button"
              className="batch-actions__toggle"
              onClick={handleToggleBatchMenu}
              aria-expanded={batchMenuOpen}
              aria-label="打开批量操作"
              title="批量操作"
            >
              <IconListCheck size={18} />
              <span>{batchMode ? selectedCount : "批量"}</span>
            </button>
          </div>
        )}
      </main>
      {deleteConfirmDialog}
      {todoDragPreview && (
        <div
          className="todo-drag-preview"
          style={{
            left: todoDragPreview.x,
            top: todoDragPreview.y,
            width: todoDragPreview.width,
            height: todoDragPreview.height,
          }}
          aria-hidden
          dangerouslySetInnerHTML={{ __html: todoDragPreview.html }}
        />
      )}
      {completionUndo && (
        <div className="completion-undo" role="status" aria-live="polite">
          <span>已完成「{completionUndo.title}」</span>
          <button type="button" onClick={handleUndoCompletion}>
            撤销
          </button>
        </div>
      )}
      {batchDeleteConfirmDialog}
      {resetConfirmDialog}
      {clearAllConfirmDialog}
      {syncConfirmDialog}
      {aboutDialog}
    </div>
  );
}

export default App;
