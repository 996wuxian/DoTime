import { useMemo, useRef, useState, type PointerEvent } from "react";
import type { Todo, TodoSubtask } from "../types";
import { RECURRENCE_LABELS, URGENCY_LABELS } from "../types";
import {
  formatClockTime,
  formatDuration,
  formatDurationHuman,
} from "../utils/time";
import { getReminderDueAt } from "../utils/reminders";
import {
  IconBell,
  IconBookmark,
  IconCheck,
  IconClock,
  IconClockHour4,
  IconChevronDown,
  IconChevronRight,
  IconGripVertical,
  IconMessageCircle,
  IconPencil,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlayerStop,
  IconPlus,
  IconRepeat,
  IconTrash,
} from "./icons";

interface TodoItemProps {
  todo: Todo;
  liveElapsed: number;
  remaining: number;
  isHighlighted?: boolean;
  isDragging?: boolean;
  itemRef?: (node: HTMLElement | null) => void;
  onStart: () => void;
  onPause: () => void;
  onStop: () => void;
  onToggle: () => void;
  onRemove: () => void;
  onEdit: () => void;
  onReset: () => void;
  onUpdateComment: (comment: string) => void;
  onToggleFavorite: () => void;
  onAddSubtask: (parentSubtaskId: string | null) => void;
  onEditSubtask: (subtaskId: string) => void;
  onSyncSubtask: (subtaskId: string) => void;
  onToggleSubtask: (subtaskId: string) => void;
  onRemoveSubtask: (subtaskId: string) => void;
  onReorderSubtask: (draggedSubtaskId: string, targetSubtaskId: string) => void;
  onStartSubtask: (subtaskId: string) => void;
  onPauseSubtask: (subtaskId: string) => void;
  onStopSubtask: (subtaskId: string) => void;
  onDragHandlePointerDown: (event: PointerEvent<HTMLButtonElement>) => void;
}

function getSubtaskStats(subtasks: readonly TodoSubtask[] = []) {
  let total = 0;
  let done = 0;
  for (const subtask of subtasks) {
    total += 1;
    if (subtask.completed) done += 1;
    for (const child of subtask.children) {
      total += 1;
      if (child.completed) done += 1;
    }
  }
  return { total, done };
}

function getDirectSubtaskStats(subtasks: readonly TodoSubtask[] = []) {
  return {
    total: subtasks.length,
    done: subtasks.filter((subtask) => subtask.completed).length,
  };
}

function getSubtaskLiveElapsed(subtask: TodoSubtask): number {
  if (subtask.isTiming && subtask.timingStartedAt != null) {
    return (
      subtask.elapsedSeconds +
      Math.floor((Date.now() - subtask.timingStartedAt) / 1000)
    );
  }
  return subtask.elapsedSeconds;
}

type SubtaskDragState = {
  pointerId: number;
  draggedId: string;
  lastTargetId: string | null;
};

function SubtaskRow({
  subtask,
  depth,
  countdownSyncEnabled,
  collapsedIds,
  onStartAdd,
  onStartEdit,
  onSync,
  draggingSubtaskId,
  onToggleCollapse,
  onToggle,
  onRemove,
  onDragHandlePointerDown,
  onStart,
  onPause,
  onStop,
}: {
  subtask: TodoSubtask;
  depth: 1 | 2;
  countdownSyncEnabled: boolean;
  collapsedIds: ReadonlySet<string>;
  onStartAdd: (parentId: string | null) => void;
  onStartEdit: (id: string) => void;
  onSync: (id: string) => void;
  draggingSubtaskId: string | null;
  onToggleCollapse: (id: string) => void;
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
  onDragHandlePointerDown: (
    id: string,
  ) => (event: PointerEvent<HTMLButtonElement>) => void;
  onStart: (id: string) => void;
  onPause: (id: string) => void;
  onStop: (id: string) => void;
}) {
  const childStats = getDirectSubtaskStats(subtask.children);
  const childrenCollapsed = collapsedIds.has(subtask.id);
  const statusLabel = subtask.completed
    ? "已完成"
    : subtask.isTiming
      ? "进行中"
      : "待开始";
  const liveElapsed = getSubtaskLiveElapsed(subtask);
  const countdownEnabled = subtask.countdownEnabled && subtask.plannedSeconds > 0;
  const showRecordElapsed = liveElapsed > 0 || subtask.isTiming;

  return (
    <li
      className={`todo-subtask todo-subtask--level-${depth} ${
        draggingSubtaskId === subtask.id ? "is-dragging" : ""
      }`}
      data-subtask-id={subtask.id}
    >
      <div className="todo-subtask__row">
        <span className="todo-subtask__branch" aria-hidden />
        <button
          type="button"
          className={`check-btn todo-subtask__check ${
            subtask.completed ? "is-checked" : ""
          }`}
          onClick={() => onToggle(subtask.id)}
          aria-label={subtask.completed ? "标记子待办未完成" : "标记子待办完成"}
          title={subtask.completed ? "标记未完成" : "标记完成"}
        >
          {subtask.completed ? <IconCheck size={11} /> : null}
        </button>

        <>
            <div className="todo-subtask__main">
              <button
                type="button"
                className={`todo-subtask__title ${
                  subtask.completed ? "is-completed" : ""
                }`}
                onClick={() => onToggle(subtask.id)}
              >
                {subtask.title}
              </button>
              <span className={`badge badge--${subtask.urgency} todo-subtask__badge`}>
                {URGENCY_LABELS[subtask.urgency]}
              </span>
              {!subtask.completed && (
                <span
                  className={`status-badge status-badge--${
                    subtask.isTiming ? "active" : "idle"
                  } todo-subtask__status`}
                >
                  {statusLabel}
                </span>
              )}
              {depth === 1 && childStats.total > 0 && (
                <button
                  type="button"
                  className="todo-subtask__child-progress"
                  onClick={() => onToggleCollapse(subtask.id)}
                  aria-expanded={!childrenCollapsed}
                  title={childrenCollapsed ? "展开子待办" : "折叠子待办"}
                >
                  {childrenCollapsed ? (
                    <IconChevronRight size={12} />
                  ) : (
                    <IconChevronDown size={12} />
                  )}
                  {childStats.done}/{childStats.total}
                </button>
              )}
            </div>
            <span className="todo-subtask__elapsed">
              {countdownEnabled ? (
                <>
                  <span className="todo-subtask__time-item">
                    <IconClock size={12} />
                    <span className="todo-subtask__time-label">计划</span>
                    {formatDuration(subtask.plannedSeconds)}
                  </span>
                  <span className="todo-subtask__time-item">
                    <IconClockHour4 size={12} />
                    <span className="todo-subtask__time-label">已用</span>
                    {formatDuration(liveElapsed)}
                  </span>
                </>
              ) : (
                showRecordElapsed && (
                  <>
                    <IconClockHour4 size={12} />
                    {formatDuration(liveElapsed)}
                  </>
                )
              )}
            </span>
            <div className="todo-subtask__actions">
              {depth === 1 && (
                <button
                  type="button"
                  onClick={() => onStartAdd(subtask.id)}
                  aria-label="添加下级子待办"
                  title="添加下级"
                >
                  <IconPlus size={14} />
                </button>
              )}
              <button
                type="button"
                onClick={() => onStartEdit(subtask.id)}
                aria-label="编辑子待办"
                title="编辑"
              >
                <IconPencil size={14} />
              </button>
              {countdownSyncEnabled && !subtask.completed && (
                <button
                  type="button"
                  onClick={() => onSync(subtask.id)}
                  aria-label="同步父待办已用时间"
                  title="同步父待办已用时间"
                >
                  <IconRepeat size={14} />
                </button>
              )}
              <button
                type="button"
                className="is-danger"
                onClick={() => onRemove(subtask.id)}
                aria-label="删除子待办"
                title="删除"
              >
                <IconTrash size={14} />
              </button>
              {subtask.recordTimeEnabled && !subtask.completed && !subtask.isTiming && (
                <button
                  type="button"
                  className="todo-subtask__timer-action"
                  onClick={() => onStart(subtask.id)}
                  aria-label="开始子待办计时"
                  title="开始计时"
                >
                  <IconPlayerPlay size={14} />
                </button>
              )}
              {subtask.isTiming && (
                <>
                  <button
                    type="button"
                    className="todo-subtask__timer-action"
                    onClick={() => onPause(subtask.id)}
                    aria-label="暂停子待办计时"
                    title="暂停计时"
                  >
                    <IconPlayerPause size={14} />
                  </button>
                  <button
                    type="button"
                    className="todo-subtask__timer-action is-danger"
                    onClick={() => onStop(subtask.id)}
                    aria-label="结束子待办计时"
                    title="结束计时"
                  >
                    <IconPlayerStop size={14} />
                  </button>
                </>
              )}
              <button
                type="button"
                className="todo-subtask__sort"
                onPointerDown={onDragHandlePointerDown(subtask.id)}
                aria-label="拖拽排序子待办"
                title="长按拖拽排序"
              >
                <IconGripVertical size={14} />
              </button>
            </div>
        </>
      </div>

      {depth === 1 && subtask.children.length > 0 && !childrenCollapsed && (
        <ol className="todo-subtasks__children">
          {subtask.children.map((child) => (
            <SubtaskRow
              key={child.id}
              subtask={child}
              depth={2}
              countdownSyncEnabled={countdownSyncEnabled}
              collapsedIds={collapsedIds}
              onStartAdd={onStartAdd}
              onStartEdit={onStartEdit}
              onSync={onSync}
              draggingSubtaskId={draggingSubtaskId}
              onToggleCollapse={onToggleCollapse}
              onToggle={onToggle}
              onRemove={onRemove}
              onDragHandlePointerDown={onDragHandlePointerDown}
              onStart={onStart}
              onPause={onPause}
              onStop={onStop}
            />
          ))}
        </ol>
      )}
    </li>
  );
}

export function TodoItem({
  todo,
  liveElapsed,
  remaining,
  isHighlighted = false,
  isDragging = false,
  itemRef,
  onStart,
  onPause,
  onStop,
  onToggle,
  onRemove,
  onEdit,
  onReset,
  onUpdateComment,
  onToggleFavorite,
  onAddSubtask,
  onEditSubtask,
  onSyncSubtask,
  onToggleSubtask,
  onRemoveSubtask,
  onReorderSubtask,
  onStartSubtask,
  onPauseSubtask,
  onStopSubtask,
  onDragHandlePointerDown,
}: TodoItemProps) {
  const [subtasksCollapsed, setSubtasksCollapsed] = useState(false);
  const [collapsedSubtaskIds, setCollapsedSubtaskIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [commentEditorOpen, setCommentEditorOpen] = useState(false);
  const [commentDraft, setCommentDraft] = useState(todo.comment ?? "");
  const countdownEnabled = todo.countdownEnabled;
  const timeTrackingEnabled = countdownEnabled || todo.recordTimeEnabled;
  const countdownSyncEnabled = countdownEnabled && todo.plannedSeconds > 0;
  const reminderEnabled = todo.reminderEnabled && Boolean(todo.reminderTime);
  const subtasks = todo.subtasks ?? [];
  const subtaskDragStateRef = useRef<SubtaskDragState | null>(null);
  const [draggingSubtaskId, setDraggingSubtaskId] = useState<string | null>(null);
  const subtaskStats = useMemo(() => getSubtaskStats(subtasks), [subtasks]);
  const showSubtasks = subtasks.length > 0;
  const statusLabel = todo.completed
    ? "已完成"
    : todo.isTiming
    ? "进行中"
    : "待开始";

  const progress =
    countdownEnabled && todo.plannedSeconds > 0
      ? Math.min(100, (liveElapsed / todo.plannedSeconds) * 100)
      : 0;

  const overtime =
    countdownEnabled && liveElapsed > todo.plannedSeconds && todo.isTiming;
  const createdTime = formatClockTime(todo.createdAt);
  const reminderDueAt = getReminderDueAt(todo);
  const reminderFired =
    reminderDueAt != null &&
    todo.reminderLastFiredAt != null &&
    todo.reminderLastFiredAt >= reminderDueAt;
  const todoComment = todo.comment?.trim() ?? "";

  const handleOpenCommentEditor = () => {
    setCommentDraft(todo.comment ?? "");
    setCommentEditorOpen(true);
  };

  const handleCancelComment = () => {
    setCommentDraft(todo.comment ?? "");
    setCommentEditorOpen(false);
  };

  const handleSaveComment = () => {
    onUpdateComment(commentDraft);
    setCommentEditorOpen(false);
  };

  const finishSubtaskDrag = () => {
    window.removeEventListener("pointermove", handleSubtaskDragMove);
    window.removeEventListener("pointerup", handleSubtaskDragEnd);
    window.removeEventListener("pointercancel", handleSubtaskDragEnd);
    subtaskDragStateRef.current = null;
    setDraggingSubtaskId(null);
  };

  const handleSubtaskDragMove = (event: globalThis.PointerEvent) => {
    const dragState = subtaskDragStateRef.current;
    if (!dragState || event.pointerId !== dragState.pointerId) return;

    event.preventDefault();
    const target = document.elementFromPoint(event.clientX, event.clientY);
    const targetItem = target?.closest<HTMLElement>("[data-subtask-id]");
    const targetId = targetItem?.dataset.subtaskId;
    if (
      !targetId ||
      targetId === dragState.draggedId ||
      targetId === dragState.lastTargetId
    ) {
      return;
    }

    onReorderSubtask(dragState.draggedId, targetId);
    dragState.lastTargetId = targetId;
  };

  const handleSubtaskDragEnd = (event: globalThis.PointerEvent) => {
    const dragState = subtaskDragStateRef.current;
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    finishSubtaskDrag();
  };

  const handleSubtaskDragHandlePointerDown =
    (id: string) => (event: PointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0) return;

      event.preventDefault();
      event.stopPropagation();

      finishSubtaskDrag();
      subtaskDragStateRef.current = {
        pointerId: event.pointerId,
        draggedId: id,
        lastTargetId: null,
      };
      setDraggingSubtaskId(id);
      window.addEventListener("pointermove", handleSubtaskDragMove, {
        passive: false,
      });
      window.addEventListener("pointerup", handleSubtaskDragEnd);
      window.addEventListener("pointercancel", handleSubtaskDragEnd);
    };

  return (
    <div
      ref={itemRef}
      data-todo-id={todo.id}
      className="todo-item-shell"
    >
    <article
      className={[
        "todo-item",
        "card",
        countdownEnabled ? "has-countdown" : "",
        reminderEnabled ? "has-reminder" : "",
        !countdownEnabled && timeTrackingEnabled && (liveElapsed > 0 || todo.isTiming)
          ? "has-record-elapsed"
          : "",
        todo.completed ? "is-completed" : "",
        todo.isTiming ? "is-timing" : "",
        overtime ? "is-overtime" : "",
        isHighlighted ? "is-highlighted" : "",
        isDragging ? "is-dragging" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <time
        className="todo-item__created-time"
        dateTime={new Date(todo.createdAt).toISOString()}
        aria-label={`添加时间 ${createdTime}`}
      >
        {createdTime}
      </time>
      <div className="todo-item__top">
        <button
          type="button"
          className={`check-btn ${todo.completed ? "is-checked" : ""}`}
          onClick={onToggle}
          aria-label={todo.completed ? "标记未完成" : "标记完成"}
          title={todo.completed ? "标记未完成" : "标记完成"}
        >
          {todo.completed ? <IconCheck size={14} /> : null}
        </button>

        <div className="todo-item__main">
          <div className="todo-item__title-row">
            <h3 className="todo-item__title">
              <button
                type="button"
                className="todo-item__title-btn"
                onClick={onToggle}
                aria-label={todo.completed ? "标记未完成" : "标记完成"}
                title={todo.completed ? "标记未完成" : "标记完成"}
              >
                {todo.title}
              </button>
            </h3>
            <span className={`badge badge--${todo.urgency}`}>
              {URGENCY_LABELS[todo.urgency]}
            </span>
            {!todo.completed && (
              <span
                className={`status-badge status-badge--${
                  todo.isTiming ? "active" : "idle"
                }`}
              >
                {statusLabel}
              </span>
            )}
            {subtaskStats.total > 0 && (
              <button
                type="button"
                className="todo-item__subtask-progress"
                onClick={() => setSubtasksCollapsed((collapsed) => !collapsed)}
                aria-expanded={!subtasksCollapsed}
                title={subtasksCollapsed ? "展开子待办" : "折叠子待办"}
              >
                {subtasksCollapsed ? (
                  <IconChevronRight size={13} />
                ) : (
                  <IconChevronDown size={13} />
                )}
                {subtaskStats.done}/{subtaskStats.total}
              </button>
            )}
          </div>

          <div className="todo-item__meta">
            {countdownEnabled && (
              <span className="meta-item">
                <IconClock size={13} />
                计划 {formatDuration(todo.plannedSeconds)}
              </span>
            )}
            {todo.reminderEnabled && todo.reminderTime && (
              <span
                className={`meta-item meta-reminder ${
                  reminderFired ? "meta-reminder--fired" : ""
                }`}
              >
                <IconBell size={13} />
                {reminderFired ? "已提醒" : "提醒"} {todo.reminderTime}
              </span>
            )}
            {todo.recurrence && (
              <span className="meta-item meta-recurrence">
                <IconRepeat size={13} />
                {RECURRENCE_LABELS[todo.recurrence.frequency]}
              </span>
            )}
            {timeTrackingEnabled && (liveElapsed > 0 || todo.isTiming) && (
              <span className="meta-item meta-elapsed">
                <IconClockHour4 size={13} />
                已用 {formatDuration(liveElapsed)}
              </span>
            )}
            {timeTrackingEnabled && todo.actualDurationSeconds != null && !todo.isTiming && (
              <span className="meta-item meta-done">
                <IconCheck size={13} />
                完成耗时 {formatDurationHuman(todo.actualDurationSeconds)}
              </span>
            )}
          </div>

        </div>

        <div className="todo-item__top-actions">
          <button
            type="button"
            className="btn btn-ghost btn-icon-only"
            onClick={() => {
              setSubtasksCollapsed(false);
              onAddSubtask(null);
            }}
            aria-label="添加子待办"
            title="添加子待办"
          >
            <IconPlus size={16} />
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-icon-only btn-edit"
            onClick={onEdit}
            aria-label="编辑待办"
            title="编辑待办"
          >
            <IconPencil size={16} />
          </button>
          <button
            type="button"
            className={`btn btn-ghost btn-icon-only todo-item__comment-action ${
              todoComment ? "has-comment" : ""
            }`}
            onClick={handleOpenCommentEditor}
            aria-label={todoComment ? "编辑评论" : "添加评论"}
            title={todoComment ? "编辑评论" : "添加评论"}
          >
            <IconMessageCircle size={16} />
          </button>
          <button
            type="button"
            className={`btn btn-ghost btn-icon-only todo-item__favorite-action ${
              todo.favorite ? "is-active" : ""
            }`}
            onClick={onToggleFavorite}
            aria-pressed={Boolean(todo.favorite)}
            aria-label={todo.favorite ? "取消收藏待办" : "收藏待办"}
            title={todo.favorite ? "取消收藏" : "收藏"}
          >
            <IconBookmark size={16} />
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-icon-only btn-delete"
            onClick={onRemove}
            aria-label="删除"
            title="删除"
          >
            <IconTrash size={16} />
          </button>
          {timeTrackingEnabled && (
            <button
              type="button"
              className="btn btn-ghost btn-icon-only"
              onClick={onReset}
              aria-label="重置倒计时和计时"
              title="重置倒计时和计时"
            >
              <IconRepeat size={16} />
            </button>
          )}
          {todo.recordTimeEnabled && !todo.completed && !todo.isTiming && (
            <button
              type="button"
              className="todo-item__timer-action"
              onClick={onStart}
              aria-label="开始待办计时"
              title="开始计时"
            >
              <IconPlayerPlay size={14} />
            </button>
          )}
          {todo.isTiming && (
            <>
              <button
                type="button"
                className="todo-item__timer-action"
                onClick={onPause}
                aria-label="暂停待办计时"
                title="暂停计时"
              >
                <IconPlayerPause size={14} />
              </button>
              <button
                type="button"
                className="todo-item__timer-action is-danger"
                onClick={onStop}
                aria-label="结束待办计时"
                title="结束计时"
              >
                <IconPlayerStop size={14} />
              </button>
            </>
          )}
          <button
            type="button"
            className="btn btn-ghost btn-icon-only btn-drag-handle"
            onPointerDown={onDragHandlePointerDown}
            aria-label="拖拽排序"
            title="长按拖拽排序"
          >
            <IconGripVertical size={16} />
          </button>
        </div>

        {countdownEnabled &&
          (todo.isTiming || (!todo.completed && liveElapsed > 0)) && (
            <div className="progress-bar todo-item__progress" aria-hidden>
              <div
                className="progress-bar__fill"
                style={{ width: `${progress}%` }}
              />
            </div>
          )}
      </div>

      {showSubtasks && !subtasksCollapsed && (
        <div className="todo-subtasks">
          {subtasks.length > 0 && (
            <ol className="todo-subtasks__list" aria-label="子待办">
              {subtasks.map((subtask) => (
                <SubtaskRow
                  key={subtask.id}
                  subtask={subtask}
                  depth={1}
                  countdownSyncEnabled={countdownSyncEnabled}
                  collapsedIds={collapsedSubtaskIds}
                  draggingSubtaskId={draggingSubtaskId}
                  onStartAdd={(parentId) => {
                    onAddSubtask(parentId);
                  }}
                  onStartEdit={onEditSubtask}
                  onSync={onSyncSubtask}
                  onToggleCollapse={(id) =>
                    setCollapsedSubtaskIds((current) => {
                      const next = new Set(current);
                      if (next.has(id)) {
                        next.delete(id);
                      } else {
                        next.add(id);
                      }
                      return next;
                    })
                  }
                  onToggle={onToggleSubtask}
                  onRemove={onRemoveSubtask}
                  onDragHandlePointerDown={handleSubtaskDragHandlePointerDown}
                  onStart={onStartSubtask}
                  onPause={onPauseSubtask}
                  onStop={onStopSubtask}
                />
              ))}
            </ol>
          )}

        </div>
      )}

      {countdownEnabled && todo.isTiming && (
        <div className="todo-item__timer">
          <div className="timer-display">
            <span className="timer-display__label">
              {overtime ? "已超时" : "剩余倒计时"}
            </span>
            <span className="timer-display__value">
              {overtime
                ? `+${formatDuration(liveElapsed - todo.plannedSeconds)}`
                : formatDuration(remaining)}
            </span>
            <span className="timer-display__sub">
              进行中 · {formatDuration(liveElapsed)}
            </span>
          </div>
        </div>
      )}

    </article>
    {commentEditorOpen && (
      <div className="todo-item__comment-editor">
        <textarea
          value={commentDraft}
          onChange={(event) => setCommentDraft(event.target.value)}
          placeholder="添加评论..."
          rows={3}
          maxLength={500}
          aria-label="待办评论"
          autoFocus
        />
        <div className="todo-item__comment-actions">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={handleCancelComment}
          >
            取消
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={handleSaveComment}
          >
            保存
          </button>
        </div>
      </div>
    )}

    {!commentEditorOpen && todoComment && (
      <div className="todo-item__comment">
        <IconMessageCircle size={14} />
        <p>{todoComment}</p>
      </div>
    )}
    </div>
  );
}
