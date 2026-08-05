import { useMemo } from "react";
import type { Todo } from "../types";
import { URGENCY_LABELS } from "../types";
import {
  formatClockTime,
  formatDisplayDate,
  formatDurationCompact,
  formatDurationHuman,
} from "../utils/time";
import {
  IconCalendarEvent,
  IconCircleCheck,
  IconClockHour4,
  IconListCheck,
  IconMessageCircle,
  IconPlayerPlay,
} from "./icons";

interface DailyReviewProps {
  todos: readonly Todo[];
  date: string;
  getLiveElapsed: (todo: Todo) => number;
  onSelectTodo: (todo: Todo) => void;
}

type ReviewTodo = {
  todo: Todo;
  liveElapsed: number;
};

function getCompletionRate(done: number, total: number) {
  return total === 0 ? 0 : Math.round((done / total) * 100);
}

function getReviewLine({
  total,
  done,
  pending,
  elapsedSeconds,
}: {
  total: number;
  done: number;
  pending: number;
  elapsedSeconds: number;
}) {
  if (total === 0) return "今天还没有待办记录。";
  const parts = [`完成 ${done}/${total}`];
  if (pending > 0) parts.push(`剩余 ${pending} 个`);
  if (elapsedSeconds > 0) parts.push(`累计 ${formatDurationHuman(elapsedSeconds)}`);
  return parts.join("，");
}

export function DailyReview({
  todos,
  date,
  getLiveElapsed,
  onSelectTodo,
}: DailyReviewProps) {
  const review = useMemo(() => {
    const dayTodos = todos
      .filter((todo) => todo.date === date)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt - b.createdAt);
    const items: ReviewTodo[] = dayTodos.map((todo) => ({
      todo,
      liveElapsed: getLiveElapsed(todo),
    }));
    const done = dayTodos.filter((todo) => todo.completed).length;
    const pending = dayTodos.length - done;
    const timing = items.filter((item) => item.todo.isTiming);
    const elapsedSeconds = items.reduce((sum, item) => sum + item.liveElapsed, 0);
    const overtime = items.filter(
      (item) =>
        item.todo.countdownEnabled &&
        item.todo.plannedSeconds > 0 &&
        item.liveElapsed > item.todo.plannedSeconds,
    );
    const topElapsed = [...items]
      .filter((item) => item.liveElapsed > 0)
      .sort((a, b) => b.liveElapsed - a.liveElapsed)
      .slice(0, 5);
    const pendingTodos = dayTodos.filter((todo) => !todo.completed).slice(0, 8);
    const commented = dayTodos
      .filter((todo) => todo.comment?.trim())
      .slice(0, 6);

    return {
      dayTodos,
      items,
      total: dayTodos.length,
      done,
      pending,
      timing,
      elapsedSeconds,
      overtime,
      topElapsed,
      pendingTodos,
      commented,
      completionRate: getCompletionRate(done, dayTodos.length),
    };
  }, [date, getLiveElapsed, todos]);

  return (
    <section className="daily-review" aria-labelledby="daily-review-title">
      <header className="daily-review__header">
        <div>
          <h2 id="daily-review-title">日复盘</h2>
          <p>{formatDisplayDate(date)}</p>
        </div>
        <strong>{getReviewLine(review)}</strong>
      </header>

      <div className="daily-review__summary" aria-label="复盘概览">
        <article className="review-metric">
          <IconListCheck size={17} />
          <span>待办</span>
          <strong>{review.total}</strong>
        </article>
        <article className="review-metric is-success">
          <IconCircleCheck size={17} />
          <span>完成率</span>
          <strong>{review.completionRate}%</strong>
        </article>
        <article className="review-metric is-primary">
          <IconClockHour4 size={17} />
          <span>累计耗时</span>
          <strong>
            {review.elapsedSeconds > 0
              ? formatDurationCompact(review.elapsedSeconds)
              : "--"}
          </strong>
        </article>
        <article className="review-metric is-warning">
          <IconPlayerPlay size={17} />
          <span>计时中</span>
          <strong>{review.timing.length}</strong>
        </article>
      </div>

      {review.total === 0 ? (
        <div className="daily-review__empty">
          <IconCalendarEvent size={18} />
          当前日期没有可复盘的待办。
        </div>
      ) : (
        <div className="daily-review__grid">
          <section className="review-section">
            <header>
              <h3>未完成</h3>
              <span>{review.pending} 个</span>
            </header>
            {review.pendingTodos.length > 0 ? (
              <ul className="review-list">
                {review.pendingTodos.map((todo) => (
                  <li key={todo.id}>
                    <button type="button" onClick={() => onSelectTodo(todo)}>
                      <span>
                        <b>{todo.title}</b>
                        <small>
                          {formatClockTime(todo.createdAt)} · {URGENCY_LABELS[todo.urgency]}
                        </small>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="review-section__empty">今天的待办都完成了。</p>
            )}
          </section>

          <section className="review-section">
            <header>
              <h3>耗时最多</h3>
              <span>{review.topElapsed.length} 个</span>
            </header>
            {review.topElapsed.length > 0 ? (
              <ul className="review-list review-list--ranked">
                {review.topElapsed.map((item, index) => (
                  <li key={item.todo.id}>
                    <button type="button" onClick={() => onSelectTodo(item.todo)}>
                      <i>{index + 1}</i>
                      <span>
                        <b>{item.todo.title}</b>
                        <small>{formatDurationHuman(item.liveElapsed)}</small>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="review-section__empty">还没有记录耗时。</p>
            )}
          </section>

          <section className="review-section">
            <header>
              <h3>异常关注</h3>
              <span>{review.overtime.length + review.timing.length} 项</span>
            </header>
            {review.overtime.length > 0 || review.timing.length > 0 ? (
              <ul className="review-list">
                {[...review.overtime, ...review.timing]
                  .filter(
                    (item, index, list) =>
                      list.findIndex((current) => current.todo.id === item.todo.id) ===
                      index,
                  )
                  .slice(0, 8)
                  .map((item) => (
                    <li key={item.todo.id}>
                      <button type="button" onClick={() => onSelectTodo(item.todo)}>
                        <span>
                          <b>{item.todo.title}</b>
                          <small>
                            {item.todo.isTiming ? "计时中" : "已超出计划"} ·{" "}
                            {formatDurationHuman(item.liveElapsed)}
                          </small>
                        </span>
                      </button>
                    </li>
                  ))}
              </ul>
            ) : (
              <p className="review-section__empty">没有超时或进行中的待办。</p>
            )}
          </section>

          <section className="review-section">
            <header>
              <h3>评论记录</h3>
              <span>{review.commented.length} 条</span>
            </header>
            {review.commented.length > 0 ? (
              <ul className="review-comments">
                {review.commented.map((todo) => (
                  <li key={todo.id}>
                    <button type="button" onClick={() => onSelectTodo(todo)}>
                      <IconMessageCircle size={14} />
                      <span>
                        <b>{todo.title}</b>
                        <small>{todo.comment?.trim()}</small>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="review-section__empty">今天没有待办评论。</p>
            )}
          </section>
        </div>
      )}
    </section>
  );
}
