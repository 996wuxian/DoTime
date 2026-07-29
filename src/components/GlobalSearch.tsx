import { useEffect, useMemo, useRef, useState } from "react";
import type { Todo, TodoDateSummary, Urgency } from "../types";
import { URGENCY_LABELS } from "../types";
import {
  DEFAULT_TODO_SEARCH_FILTERS,
  isTodoSearchDateRangeInvalid,
  searchTodos,
  type TodoSearchFilters,
  type TodoSearchStatus,
} from "../domain/todoSearch";
import { DatePickerField } from "./DatePickerField";
import { IconClose, IconFilter, IconSearch } from "./icons";
import { TodoSearchResults } from "./TodoSearchResults";

interface GlobalSearchProps {
  todos: readonly Todo[];
  anchorDate: string;
  todoDateSummaries: ReadonlyMap<string, TodoDateSummary>;
  onSelectTodo: (todo: Todo) => void;
}

const STATUSES: Array<{ value: TodoSearchStatus; label: string }> = [
  { value: "all", label: "全部" },
  { value: "pending", label: "待办" },
  { value: "completed", label: "已完成" },
  { value: "timing", label: "计时中" },
];
const URGENCIES: Array<"all" | Urgency> = [
  "all",
  "low",
  "medium",
  "high",
  "critical",
];

export function GlobalSearch({
  todos,
  anchorDate,
  todoDateSummaries,
  onSelectTodo,
}: GlobalSearchProps) {
  const [open, setOpen] = useState(false);
  const [filters, setFilters] = useState<TodoSearchFilters>(
    DEFAULT_TODO_SEARCH_FILTERS,
  );
  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const invalidDateRange = isTodoSearchDateRangeInvalid(filters);
  const results = useMemo(
    () => searchTodos(todos, filters),
    [filters, todos],
  );
  const hasActiveFilters =
    filters.query.trim().length > 0 ||
    filters.status !== "all" ||
    filters.urgency !== "all" ||
    filters.startDate != null ||
    filters.endDate != null;

  const updateFilter = <K extends keyof TodoSearchFilters>(
    key: K,
    value: TodoSearchFilters[K],
  ) => {
    setFilters((current) => ({ ...current, [key]: value }));
  };

  const closeSearch = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && containerRef.current?.contains(target)) return;
      setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (containerRef.current?.querySelector(".calendar-popover")) return;
      closeSearch();
    };
    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="global-search">
      <button
        ref={triggerRef}
        type="button"
        className={`btn btn-ghost btn-icon-only global-search__toggle ${
          open ? "is-active" : ""
        }`}
        onClick={() => setOpen((current) => !current)}
        aria-label="全局搜索"
        aria-expanded={open}
        aria-haspopup="dialog"
        title="全局搜索"
      >
        <IconSearch size={17} />
      </button>

      {open && (
        <section
          className="global-search__panel"
          role="dialog"
          aria-label="全局搜索与筛选"
        >
          <header className="global-search__header">
            <div className="global-search__input-wrap">
              <IconSearch size={16} />
              <input
                ref={inputRef}
                value={filters.query}
                onChange={(event) => updateFilter("query", event.target.value)}
                placeholder="搜索所有日期的待办"
                aria-label="搜索所有日期的待办"
              />
              {filters.query && (
                <button
                  type="button"
                  onClick={() => updateFilter("query", "")}
                  aria-label="清空关键词"
                  title="清空关键词"
                >
                  <IconClose size={14} />
                </button>
              )}
            </div>
            <button
              type="button"
              className="btn btn-ghost btn-icon-only global-search__close"
              onClick={closeSearch}
              aria-label="关闭搜索"
              title="关闭搜索"
            >
              <IconClose size={16} />
            </button>
          </header>

          <div className="global-search__filters">
            <div className="global-search__filter-title">
              <span><IconFilter size={14} />筛选</span>
              <button
                type="button"
                disabled={!hasActiveFilters}
                onClick={() => setFilters(DEFAULT_TODO_SEARCH_FILTERS)}
              >
                重置
              </button>
            </div>
            <div className="global-search__filter-row">
              <span>状态</span>
              <div className="global-search__segments" role="group" aria-label="状态筛选">
                {STATUSES.map((status) => (
                  <button
                    key={status.value}
                    type="button"
                    className={filters.status === status.value ? "is-active" : ""}
                    onClick={() => updateFilter("status", status.value)}
                    aria-pressed={filters.status === status.value}
                  >
                    {status.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="global-search__filter-row">
              <span>紧急程度</span>
              <div className="global-search__urgencies" role="group" aria-label="紧急程度筛选">
                {URGENCIES.map((urgency) => (
                  <button
                    key={urgency}
                    type="button"
                    className={`${urgency === "all" ? "" : `is-${urgency}`} ${
                      filters.urgency === urgency ? "is-active" : ""
                    }`}
                    onClick={() => updateFilter("urgency", urgency)}
                    aria-pressed={filters.urgency === urgency}
                  >
                    {urgency === "all" ? "全部" : URGENCY_LABELS[urgency]}
                  </button>
                ))}
              </div>
            </div>
            <div className="global-search__dates">
              <DatePickerField
                label="起始日期"
                emptyLabel="不限起始日期"
                value={filters.startDate}
                fallbackDate={anchorDate}
                todoSummaries={todoDateSummaries}
                optional
                onChange={(date) => updateFilter("startDate", date)}
              />
              <DatePickerField
                label="结束日期"
                emptyLabel="不限结束日期"
                value={filters.endDate}
                fallbackDate={anchorDate}
                todoSummaries={todoDateSummaries}
                optional
                onChange={(date) => updateFilter("endDate", date)}
              />
            </div>
          </div>

          <div className="global-search__results-header">
            <strong>搜索结果</strong>
            <span>{invalidDateRange ? "日期范围无效" : `${results.length} 项`}</span>
          </div>
          <div className="global-search__results">
            <TodoSearchResults
              todos={results}
              query={filters.query}
              invalidDateRange={invalidDateRange}
              onSelect={(todo) => {
                setOpen(false);
                onSelectTodo(todo);
              }}
            />
          </div>
        </section>
      )}
    </div>
  );
}
