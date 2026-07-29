import type { Todo, Urgency } from "../types";

export type TodoSearchStatus = "all" | "pending" | "completed" | "timing";
export type TodoSearchUrgency = "all" | Urgency;

export interface TodoSearchFilters {
  query: string;
  status: TodoSearchStatus;
  urgency: TodoSearchUrgency;
  startDate: string | null;
  endDate: string | null;
}

export const DEFAULT_TODO_SEARCH_FILTERS: TodoSearchFilters = {
  query: "",
  status: "all",
  urgency: "all",
  startDate: null,
  endDate: null,
};

export function isTodoSearchDateRangeInvalid(
  filters: Pick<TodoSearchFilters, "startDate" | "endDate">,
): boolean {
  return (
    filters.startDate != null &&
    filters.endDate != null &&
    filters.startDate > filters.endDate
  );
}

export function getTodoSearchStatus(
  todo: Todo,
): Exclude<TodoSearchStatus, "all"> {
  if (todo.isTiming) return "timing";
  if (todo.completed) return "completed";
  return "pending";
}

function getStatusRank(todo: Todo): number {
  const status = getTodoSearchStatus(todo);
  if (status === "timing") return 0;
  if (status === "pending") return 1;
  return 2;
}

export function searchTodos(
  todos: readonly Todo[],
  filters: TodoSearchFilters,
): Todo[] {
  if (isTodoSearchDateRangeInvalid(filters)) return [];

  const normalizedQuery = filters.query.trim().toLocaleLowerCase();
  const results: Todo[] = [];
  for (const todo of todos) {
    if (
      normalizedQuery.length > 0 &&
      !todo.title.toLocaleLowerCase().includes(normalizedQuery)
    ) {
      continue;
    }
    if (
      filters.status !== "all" &&
      getTodoSearchStatus(todo) !== filters.status
    ) {
      continue;
    }
    if (filters.urgency !== "all" && todo.urgency !== filters.urgency) {
      continue;
    }
    if (filters.startDate != null && todo.date < filters.startDate) continue;
    if (filters.endDate != null && todo.date > filters.endDate) continue;
    results.push(todo);
  }

  return results.sort((a, b) => {
    const statusDifference = getStatusRank(a) - getStatusRank(b);
    if (statusDifference !== 0) return statusDifference;
    const dateDifference = b.date.localeCompare(a.date);
    if (dateDifference !== 0) return dateDifference;
    return b.createdAt - a.createdAt;
  });
}
