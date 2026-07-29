import type { ReactNode } from "react";
import type { Todo } from "../types";
import { URGENCY_LABELS } from "../types";
import { getTodoElapsedSeconds } from "../domain/statistics";
import { getTodoSearchStatus } from "../domain/todoSearch";
import { formatDisplayDate, formatDurationCompact } from "../utils/time";
import {
  IconCalendarEvent,
  IconCircleCheck,
  IconClockHour4,
  IconFlag,
  IconListCheck,
} from "./icons";

interface TodoSearchResultsProps {
  todos: readonly Todo[];
  query: string;
  invalidDateRange: boolean;
  onSelect: (todo: Todo) => void;
}

const MAX_VISIBLE_RESULTS = 100;
const STATUS_LABELS = {
  pending: "待办",
  completed: "已完成",
  timing: "计时中",
} as const;

function highlightTitle(title: string, query: string): ReactNode {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return title;
  const index = title.toLocaleLowerCase().indexOf(normalizedQuery);
  if (index < 0) return title;
  return (
    <>
      {title.slice(0, index)}
      <mark>{title.slice(index, index + normalizedQuery.length)}</mark>
      {title.slice(index + normalizedQuery.length)}
    </>
  );
}

export function TodoSearchResults({
  todos,
  query,
  invalidDateRange,
  onSelect,
}: TodoSearchResultsProps) {
  if (invalidDateRange) {
    return (
      <div className="global-search__empty is-error" role="alert">
        起始日期不能晚于结束日期
      </div>
    );
  }
  if (todos.length === 0) {
    return <div className="global-search__empty">没有匹配的待办</div>;
  }

  const visibleTodos = todos.slice(0, MAX_VISIBLE_RESULTS);
  return (
    <>
      <ul className="global-search-results" aria-label="搜索结果">
        {visibleTodos.map((todo) => {
          const status = getTodoSearchStatus(todo);
          const elapsedSeconds = getTodoElapsedSeconds(todo);
          return (
            <li key={todo.id}>
              <button type="button" onClick={() => onSelect(todo)}>
                <span className={`global-search-results__status is-${status}`}>
                  {status === "timing" ? (
                    <IconClockHour4 size={15} />
                  ) : status === "completed" ? (
                    <IconCircleCheck size={15} />
                  ) : (
                    <IconListCheck size={15} />
                  )}
                </span>
                <span className="global-search-results__main">
                  <strong>{highlightTitle(todo.title, query)}</strong>
                  <span className="global-search-results__meta">
                    <span>
                      <IconCalendarEvent size={13} />
                      {formatDisplayDate(todo.date)}
                    </span>
                    <span>
                      <IconFlag size={13} />
                      {URGENCY_LABELS[todo.urgency]}
                    </span>
                    <span className={`is-${status}`}>
                      {STATUS_LABELS[status]}
                    </span>
                  </span>
                </span>
                <span className="global-search-results__duration">
                  {elapsedSeconds > 0
                    ? formatDurationCompact(elapsedSeconds)
                    : "—"}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {todos.length > MAX_VISIBLE_RESULTS && (
        <div className="global-search__limit" role="status">
          仅显示前 {MAX_VISIBLE_RESULTS} 项，共 {todos.length} 项
        </div>
      )}
    </>
  );
}
