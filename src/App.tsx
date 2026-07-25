import { useState } from "react";
import { TodoForm } from "./components/TodoForm";
import { TodoItem } from "./components/TodoItem";
import {
  WindowControls,
  toggleMaximizeFromTitlebar,
} from "./components/WindowControls";
import {
  IconCalendarEvent,
  IconChevronLeft,
  IconChevronRight,
  IconCircleCheck,
  IconClockHour4,
  IconListCheck,
} from "./components/icons";
import { useTodos } from "./hooks/useTodos";
import {
  formatDateKey,
  formatDisplayDate,
  formatDurationHuman,
} from "./utils/time";
import "./App.css";

function App() {
  const [selectedDate, setSelectedDate] = useState(() => formatDateKey());
  const [todoFormOpen, setTodoFormOpen] = useState(false);
  const {
    dayTodos,
    stats,
    addTodo,
    removeTodo,
    toggleComplete,
    updatePlanned,
    startTiming,
    stopTiming,
    getLiveElapsed,
    getCountdownRemaining,
    shiftDate,
  } = useTodos(selectedDate);

  const isToday = selectedDate === formatDateKey();

  return (
    <div className="app">
      <header
        className="titlebar"
        data-tauri-drag-region
        onDoubleClick={() => void toggleMaximizeFromTitlebar()}
      >
        <div className="brand" data-tauri-drag-region>
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

        <div className="titlebar-drag" data-tauri-drag-region />

        <div className="titlebar-actions">
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
                  ? formatDurationHuman(stats.totalActual)
                  : "—"}
              </span>
            </div>
          </section>
          <div className="date-nav">
            <button
              type="button"
              className="btn btn-ghost btn-icon-only"
              onClick={() => setSelectedDate((d) => shiftDate(d, -1))}
              aria-label="前一天"
              title="前一天"
            >
              <IconChevronLeft size={18} />
            </button>
            <button
              type="button"
              className="date-nav__current"
              onClick={() => setSelectedDate(formatDateKey())}
              title="回到今天"
            >
              <IconCalendarEvent size={14} />
              <span className="date-nav__text">
                {formatDisplayDate(selectedDate)}
                {!isToday && (
                  <span className="date-nav__hint">点此回今天</span>
                )}
              </span>
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-icon-only"
              onClick={() => setSelectedDate((d) => shiftDate(d, 1))}
              aria-label="后一天"
              title="后一天"
            >
              <IconChevronRight size={18} />
            </button>
          </div>
          <WindowControls />
        </div>
      </header>

      <main className="app-body">
        <div className="app-content">
          <TodoForm
            onAdd={addTodo}
            open={todoFormOpen}
            onOpenChange={setTodoFormOpen}
          />

          {!todoFormOpen && (
            <>
              <section className="todo-list">
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
                      点击上方「新建待办」，设置紧急程度与倒计时，开始高效一天。
                    </p>
                  </div>
                ) : (
                  dayTodos.map((todo) => (
                    <TodoItem
                      key={todo.id}
                      todo={todo}
                      liveElapsed={getLiveElapsed(todo)}
                      remaining={getCountdownRemaining(todo)}
                      onStart={() => startTiming(todo.id)}
                      onStop={() => stopTiming(todo.id)}
                      onToggle={() => toggleComplete(todo.id)}
                      onRemove={() => removeTodo(todo.id)}
                      onUpdatePlanned={(s) => updatePlanned(todo.id, s)}
                    />
                  ))
                )}
              </section>

              <footer className="app-footer">
                数据保存在本地 · 同时仅一项计时 · 结束计时将记录完成耗时
              </footer>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

export default App;
