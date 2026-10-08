import { useId, useState, type KeyboardEvent } from "react";
import type { Todo } from "../types";
import { useDailyPinnedDrag, type DailyPinnedDayDropState } from "../hooks/useDailyPinnedDrag";
import type { DailyPinnedDayDropTarget } from "../domain/dailyPinnedTodos";
import { formatDisplayDate } from "../utils/time";
import { IconPin, IconPinOff } from "./icons";

interface Props {
  todos: readonly Todo[];
  isDropTarget: boolean;
  onOpen: (todo: Todo) => void;
  onUnpin: (id: string) => void;
  onReorder: (id: string, targetId: string, position: "before" | "after") => void;
  onDropToDay: (id: string, target: DailyPinnedDayDropTarget | null) => void;
  onDayDropTargetChange: (target: DailyPinnedDayDropState | null) => void;
}

function TaskLabel({ todo }: { todo: Todo }) {
  return <>
    <span className="daily-pinned__task-title">{todo.title}</span>
    <span className="daily-pinned__task-date">
      {formatDisplayDate(todo.date)} · {todo.completed ? "已完成" : todo.isTiming ? "计时中" : "待办"}
    </span>
  </>;
}

export function DailyPinnedTodos({ todos, isDropTarget, onOpen, onUnpin, onReorder, onDropToDay, onDayDropTargetChange }: Props) {
  const instructionsId = useId();
  const [announcement, setAnnouncement] = useState("");
  const reorder: Props["onReorder"] = (id, targetId, position) => {
    onReorder(id, targetId, position);
    const todo = todos.find((item) => item.id === id);
    if (todo) setAnnouncement(`已调整「${todo.title}」的顺序。`);
  };
  const { listRef, preview, start, onClickCapture, onPointerDownCapture } =
    useDailyPinnedDrag(todos.map((todo) => todo.id), { onReorder: reorder, onDropToDay, onDayDropTargetChange });
  const previewTodo = preview ? todos.find((todo) => todo.id === preview.id) : null;

  const onKeyDown = (index: number, event: KeyboardEvent<HTMLButtonElement>) => {
    if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
    event.preventDefault();
    const direction = event.key === "ArrowUp" ? -1 : 1;
    const target = todos[index + direction];
    if (target) reorder(todos[index].id, target.id, direction < 0 ? "before" : "after");
  };

  return <>
    <aside
      className={`daily-pinned ${isDropTarget ? "is-drop-target" : ""} ${preview ? "is-sorting" : ""}`}
      data-daily-pin-zone
      aria-label="每日固定待办"
      onClickCapture={onClickCapture}
      onPointerDownCapture={onPointerDownCapture}
    >
      <div className="daily-pinned__heading">
        <span className="daily-pinned__icon" aria-hidden="true"><IconPin size={17} /></span>
        <h2>每日固定</h2>
        <span className="daily-pinned__count">{todos.length}</span>
      </div>
      <p className="daily-pinned__hint">长按拖动排序，拖到待办列表可添加</p>
      <span id={instructionsId} className="daily-pinned__sr-only">
        点击查看待办，长按拖动调整顺序或拖到右侧待办列表添加，也可按 Alt 加上、下方向键排序。
      </span>
      <span role="status" className="daily-pinned__sr-only">{announcement}</span>
      {todos.length === 0 ? (
        <div className="daily-pinned__empty">按住待办右侧的拖拽手柄，拖入此处</div>
      ) : (
        <ul ref={listRef} className="daily-pinned__list">
          {todos.map((todo, index) => (
            <li
              key={todo.id}
              data-daily-pinned-id={todo.id}
              className={`daily-pinned__item ${todo.completed ? "is-completed" : ""} ${preview?.id === todo.id ? "is-dragging" : ""} ${preview?.target?.type === "pinned" && preview.target.id === todo.id ? `is-drop-${preview.target.position}` : ""}`}
            >
              <button
                type="button"
                className="daily-pinned__task"
                onPointerDown={(event) => start(todo.id, event)}
                onKeyDown={(event) => onKeyDown(index, event)}
                onClick={() => onOpen(todo)}
                aria-describedby={instructionsId}
                aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
                title={`查看 ${todo.date} 的待办，长按拖动排序`}
              >
                <TaskLabel todo={todo} />
              </button>
              <button
                type="button"
                className="daily-pinned__remove"
                onClick={() => onUnpin(todo.id)}
                aria-label={`取消每日固定：${todo.title}`}
                title="取消每日固定"
              >
                <IconPinOff size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
    {preview && previewTodo && (
      <div
        className={`daily-pinned__drag-preview daily-pinned__item ${previewTodo.completed ? "is-completed" : ""}`}
        style={{ left: preview.x, top: preview.y, width: preview.width }}
        aria-hidden="true"
      >
        <div className="daily-pinned__task"><TaskLabel todo={previewTodo} /></div>
        <span className="daily-pinned__remove"><IconPinOff size={15} /></span>
      </div>
    )}
  </>;
}
