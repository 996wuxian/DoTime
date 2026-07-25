import { useState } from "react";
import type { Todo } from "../types";
import { URGENCY_LABELS } from "../types";
import { formatDuration, formatDurationHuman } from "../utils/time";
import { CountdownDial } from "./CountdownDial";
import {
  IconCheck,
  IconClock,
  IconClockHour4,
  IconPlayerPlay,
  IconPlayerStop,
  IconTrash,
} from "./icons";

interface TodoItemProps {
  todo: Todo;
  liveElapsed: number;
  remaining: number;
  onStart: () => void;
  onStop: () => void;
  onToggle: () => void;
  onRemove: () => void;
  onUpdatePlanned: (seconds: number) => void;
}

export function TodoItem({
  todo,
  liveElapsed,
  remaining,
  onStart,
  onStop,
  onToggle,
  onRemove,
  onUpdatePlanned,
}: TodoItemProps) {
  const [editingPlan, setEditingPlan] = useState(false);

  const progress =
    todo.plannedSeconds > 0
      ? Math.min(100, (liveElapsed / todo.plannedSeconds) * 100)
      : 0;

  const overtime = liveElapsed > todo.plannedSeconds && todo.isTiming;

  return (
    <article
      className={[
        "todo-item",
        "card",
        todo.completed ? "is-completed" : "",
        todo.isTiming ? "is-timing" : "",
        overtime ? "is-overtime" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
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
            <h3 className="todo-item__title">{todo.title}</h3>
            <span className={`badge badge--${todo.urgency}`}>
              {URGENCY_LABELS[todo.urgency]}
            </span>
          </div>

          <div className="todo-item__meta">
            <span className="meta-item">
              <IconClock size={13} />
              计划 {formatDuration(todo.plannedSeconds)}
            </span>
            {(liveElapsed > 0 || todo.isTiming) && (
              <span className="meta-item meta-elapsed">
                <IconClockHour4 size={13} />
                已用 {formatDuration(liveElapsed)}
              </span>
            )}
            {todo.actualDurationSeconds != null && !todo.isTiming && (
              <span className="meta-item meta-done">
                <IconCheck size={13} />
                完成耗时 {formatDurationHuman(todo.actualDurationSeconds)}
              </span>
            )}
          </div>

          {(todo.isTiming || (!todo.completed && liveElapsed > 0)) && (
            <div className="progress-bar" aria-hidden>
              <div
                className="progress-bar__fill"
                style={{ width: `${progress}%` }}
              />
            </div>
          )}
        </div>

        <button
          type="button"
          className="btn btn-ghost btn-icon-only"
          onClick={onRemove}
          aria-label="删除"
          title="删除"
        >
          <IconTrash size={16} />
        </button>
      </div>

      {todo.isTiming && (
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

      {!todo.completed && !todo.isTiming && editingPlan && (
        <div className="todo-item__edit-plan">
          <CountdownDial
            value={todo.plannedSeconds}
            onChange={onUpdatePlanned}
            size={140}
          />
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setEditingPlan(false)}
          >
            <IconCheck size={14} />
            完成设置
          </button>
        </div>
      )}

      {(!todo.completed || todo.isTiming) && (
        <div className="todo-item__actions">
          {!todo.completed && !todo.isTiming && (
            <>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setEditingPlan((v) => !v)}
              >
                <IconClock size={14} />
                {editingPlan ? "收起" : "调整倒计时"}
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={onStart}
              >
                <IconPlayerPlay size={14} />
                开始计时
              </button>
            </>
          )}
          {todo.isTiming && (
            <button
              type="button"
              className="btn btn-danger btn-sm"
              onClick={onStop}
            >
              <IconPlayerStop size={14} />
              结束计时
            </button>
          )}
        </div>
      )}
    </article>
  );
}
