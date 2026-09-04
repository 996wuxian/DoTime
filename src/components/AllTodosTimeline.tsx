import { useEffect, useMemo, useRef, useState } from "react";
import type { Todo } from "../types";
import { URGENCY_LABELS } from "../types";
import {
  formatClockTime,
  formatDuration,
  formatDurationHuman,
} from "../utils/time";
import {
  IconCheck,
  IconClock,
  IconClockHour4,
  IconListCheck,
} from "./icons";

interface AllTodosTimelineProps {
  todos: readonly Todo[];
  activeDate: string;
  onSelectTodo: (todo: Todo) => void;
}

const DATE_GROUP_PAGE_SIZE = 8;
const CHINESE_MONTHS = [
  "一",
  "二",
  "三",
  "四",
  "五",
  "六",
  "七",
  "八",
  "九",
  "十",
  "十一",
  "十二",
];

function formatDateHeading(dateKey: string) {
  const [year, month, day] = dateKey.split("-");
  return `${year}年${Number(month)}月${Number(day)}日`;
}

function formatMonthHeading(dateKey: string) {
  const [, month] = dateKey.split("-");
  return `${CHINESE_MONTHS[Number(month) - 1]}月`;
}

function TodoTimelineItem({
  todo,
  onSelectTodo,
}: {
  todo: Todo;
  onSelectTodo: (todo: Todo) => void;
}) {
  const statusLabel = todo.completed
    ? "已完成"
    : todo.isTiming
      ? "进行中"
      : "未完成";

  return (
    <button
      type="button"
      className={[
        "plan-all-todos__item",
        todo.completed ? "is-completed" : "",
        todo.isTiming ? "is-timing" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={() => onSelectTodo(todo)}
      aria-label={`查看待办：${todo.title}`}
    >
      <span className="plan-all-todos__status" aria-hidden="true">
        {todo.completed ? <IconCheck size={13} /> : null}
      </span>
      <div className="plan-all-todos__body">
        <div className="plan-all-todos__title-row">
          <strong>{todo.title}</strong>
          <span className={`plan-all-todos__urgency is-${todo.urgency}`}>
            {URGENCY_LABELS[todo.urgency]}
          </span>
        </div>
        <div className="plan-all-todos__meta">
          <span className={`plan-all-todos__state is-${todo.completed ? "done" : todo.isTiming ? "active" : "pending"}`}>
            {statusLabel}
          </span>
          <span>
            <IconClock size={13} />
            {formatClockTime(todo.createdAt)}
          </span>
          {todo.countdownEnabled && (
            <span>计划 {formatDuration(todo.plannedSeconds)}</span>
          )}
          {todo.actualDurationSeconds != null && (
            <span>
              <IconClockHour4 size={13} />
              {formatDurationHuman(todo.actualDurationSeconds)}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

export function AllTodosTimeline({
  todos,
  activeDate,
  onSelectTodo,
}: AllTodosTimelineProps) {
  const [visibleDateCount, setVisibleDateCount] = useState(
    DATE_GROUP_PAGE_SIZE,
  );
  const [selectedDate, setSelectedDate] = useState(activeDate);
  const listRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const dateRefs = useRef(new Map<string, HTMLElement>());

  const groups = useMemo(() => {
    const todosByDate = new Map<string, Todo[]>();
    for (const todo of todos) {
      const dateTodos = todosByDate.get(todo.date) ?? [];
      dateTodos.push(todo);
      todosByDate.set(todo.date, dateTodos);
    }

    return Array.from(todosByDate.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([date, dateTodos]) => ({
        date,
        todos: [...dateTodos].sort(
          (left, right) =>
            left.sortOrder - right.sortOrder ||
            left.createdAt - right.createdAt,
        ),
      }));
  }, [todos]);

  useEffect(() => {
    setVisibleDateCount(Math.min(DATE_GROUP_PAGE_SIZE, groups.length));
  }, [groups]);

  useEffect(() => {
    setSelectedDate(activeDate);
  }, [activeDate]);

  const hasMore = visibleDateCount < groups.length;

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (sentinel == null || !hasMore) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setVisibleDateCount((current) =>
          Math.min(current + DATE_GROUP_PAGE_SIZE, groups.length),
        );
      },
      { root: listRef.current, rootMargin: "240px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [groups.length, hasMore]);

  const visibleGroups = groups.slice(0, visibleDateCount);
  const firstGroup = groups[0];
  const lastGroup = groups[groups.length - 1];

  const scrollToDate = (date: string) => {
    const targetIndex = groups.findIndex((group) => group.date === date);
    if (targetIndex < 0) return;
    setSelectedDate(date);

    if (targetIndex >= visibleDateCount) {
      setVisibleDateCount(targetIndex + 1);
      window.requestAnimationFrame(() => {
        dateRefs.current.get(date)?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      });
      return;
    }

    dateRefs.current.get(date)?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };

  if (groups.length === 0) {
    return (
      <div className="plan-all-todos plan-all-todos--empty" role="status">
        <IconListCheck size={22} />
        <span>还没有待办</span>
      </div>
    );
  }

  return (
    <div className="plan-all-todos">
      <div ref={listRef} className="plan-all-todos__list" role="list">
        {visibleGroups.map((group) => (
          <section
            key={group.date}
            ref={(node) => {
              if (node == null) {
                dateRefs.current.delete(group.date);
              } else {
                dateRefs.current.set(group.date, node);
              }
            }}
            className="plan-all-todos__group"
            aria-labelledby={`plan-all-todos-${group.date}`}
          >
            <h3
              id={`plan-all-todos-${group.date}`}
              className="plan-all-todos__date"
            >
              {formatDateHeading(group.date)}
              <span>{group.todos.length} 个待办</span>
            </h3>
            <div className="plan-all-todos__items">
              {group.todos.map((todo) => (
                <TodoTimelineItem
                  key={todo.id}
                  todo={todo}
                  onSelectTodo={onSelectTodo}
                />
              ))}
            </div>
          </section>
        ))}
        <div
          ref={sentinelRef}
          className="plan-all-todos__sentinel"
          role="status"
          aria-label={
            hasMore ? "正在加载更多待办" : "已显示全部待办"
          }
        >
          {hasMore ? <span aria-hidden="true" /> : null}
        </div>
      </div>

      <aside className="plan-all-todos__rail" aria-label="待办日期索引">
        <span className="plan-all-todos__rail-month">
          {formatMonthHeading(firstGroup.date)}
        </span>
        <div className="plan-all-todos__rail-ticks">
          {groups.map((group) => (
            <button
              key={group.date}
              type="button"
              className={[
                "plan-all-todos__rail-tick",
                group.date === selectedDate ? "is-active" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              onClick={() => scrollToDate(group.date)}
              aria-label={`跳转到${formatDateHeading(group.date)}`}
              aria-current={group.date === selectedDate ? "date" : undefined}
              title={formatDateHeading(group.date)}
            />
          ))}
        </div>
        <span className="plan-all-todos__rail-month">
          {formatMonthHeading(lastGroup.date)}
        </span>
      </aside>
    </div>
  );
}
