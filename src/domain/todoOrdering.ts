import { URGENCY_ORDER, type Todo, type TodoCategoryDivider } from "../types";

export function compareTodoDefaultOrder(a: Todo, b: Todo): number {
  return URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency] || b.createdAt - a.createdAt;
}

export function getDayTodos(todos: readonly Todo[], date: string, manualSort: boolean): Todo[] {
  return todos.filter((todo) => todo.date === date).sort(
    manualSort
      ? (a, b) => a.sortOrder - b.sortOrder || a.createdAt - b.createdAt
      : compareTodoDefaultOrder,
  );
}

export type TodoTimelineItem =
  | { type: "todo"; todo: Todo }
  | { type: "category"; divider: TodoCategoryDivider };

export function getTodoTimelineItems(
  orderedTodos: readonly Todo[],
  dividers: readonly TodoCategoryDivider[],
): TodoTimelineItem[] {
  const items: TodoTimelineItem[] = orderedTodos.map((todo) => ({ type: "todo", todo }));
  // Categories have explicit positions, so their day already uses manual ordering.
  if (dividers.length === 0) return items;
  items.push(...dividers.map((divider) => ({ type: "category" as const, divider })));
  return items.sort((a, b) => {
    const first = a.type === "todo" ? a.todo : a.divider;
    const second = b.type === "todo" ? b.todo : b.divider;
    return first.sortOrder - second.sortOrder || first.createdAt - second.createdAt;
  });
}

/** Freeze the displayed order before the first explicit placement on a day. */
export function materializeDayTodoOrder(todos: Todo[], date: string): Todo[] {
  const orderById = new Map(
    getDayTodos(todos, date, false).map((todo, index) => [todo.id, (index + 1) * 1000]),
  );
  return todos.map((todo) => {
    const sortOrder = orderById.get(todo.id);
    return sortOrder == null || sortOrder === todo.sortOrder ? todo : { ...todo, sortOrder };
  });
}
