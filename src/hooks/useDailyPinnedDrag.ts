import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import type { DailyPinnedDayDropTarget } from "../domain/dailyPinnedTodos";

type DropTarget =
  | { type: "pinned"; id: string; position: "before" | "after" }
  | { type: "day"; target: DailyPinnedDayDropTarget | null };
export type DailyPinnedDayDropState = Extract<DropTarget, { type: "day" }>;
type DragPreview = {
  id: string;
  x: number;
  y: number;
  width: number;
  target: DropTarget | null;
};
type DragSession = { id: string; dispose: () => void; cancel: () => void };
type Reorder = (id: string, targetId: string, position: "before" | "after") => void;
type DragActions = {
  onReorder: Reorder;
  onDropToDay: (id: string, target: DailyPinnedDayDropTarget | null) => void;
  onDayDropTargetChange: (target: DailyPinnedDayDropState | null) => void;
};

function sameTarget(a: DropTarget | null, b: DropTarget | null): boolean {
  if (!a || !b) return a === b;
  if (a.type === "pinned" && b.type === "pinned") return a.id === b.id && a.position === b.position;
  if (a.type === "day" && b.type === "day") {
    return a.target?.targetId === b.target?.targetId &&
      a.target?.targetType === b.target?.targetType && a.target?.position === b.target?.position;
  }
  return false;
}

const LONG_PRESS_MS = 180;
const CANCEL_DISTANCE = 8;
const SCROLL_EDGE = 32;

export function useDailyPinnedDrag(ids: readonly string[], actions: DragActions) {
  const listRef = useRef<HTMLUListElement>(null);
  const sessionRef = useRef<DragSession | null>(null);
  const suppressClickRef = useRef(false);
  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  const [preview, setPreview] = useState<DragPreview | null>(null);

  useEffect(() => () => sessionRef.current?.dispose(), []);
  useEffect(() => {
    const session = sessionRef.current;
    if (session && !ids.includes(session.id)) session.cancel();
  }, [ids]);

  const start = (id: string, event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || !event.isPrimary || !ids.includes(id)) return;
    sessionRef.current?.cancel();
    suppressClickRef.current = false;
    const item = event.currentTarget.closest<HTMLElement>("[data-daily-pinned-id]");
    const list = listRef.current;
    if (!item || !list) return;
    const rect = item.getBoundingClientRect();
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    const offsetX = startX - rect.left;
    const offsetY = startY - rect.top;
    let point = { x: startX, y: startY };
    let active = false;
    let scrolling = false;
    let target: DropTarget | null = null;
    let frameId = 0;
    let lastFrameTime = 0;

    const updateTarget = () => {
      const previousTarget = target;
      const bounds = list.getBoundingClientRect();
      target = null;
      const dayList = document.elementFromPoint(point.x, point.y)?.closest<HTMLElement>("[data-daily-todo-list]");
      if (dayList) {
        const items = Array.from(dayList.querySelectorAll<HTMLElement>("[data-todo-id], [data-category-id]"));
        const candidate = items.find((node) => point.y < node.getBoundingClientRect().bottom) ?? items[items.length - 1];
        const targetId = candidate?.dataset.todoId ?? candidate?.dataset.categoryId;
        const bounds = candidate?.getBoundingClientRect();
        target = {
          type: "day",
          target: candidate && targetId && bounds ? {
            targetId,
            targetType: candidate.dataset.todoId ? "todo" : "category",
            position: point.y < bounds.top + bounds.height / 2 ? "before" : "after",
          } : null,
        };
      }
      else if (point.x >= bounds.left && point.x <= bounds.right &&
          point.y >= bounds.top && point.y <= bounds.bottom) {
        const items = Array.from(list.querySelectorAll<HTMLElement>("[data-daily-pinned-id]"));
        const candidate = items.find((node) => point.y < node.getBoundingClientRect().bottom) ?? items[items.length - 1];
        const candidateId = candidate?.dataset.dailyPinnedId;
        if (candidate && candidateId && candidateId !== id) {
          const bounds = candidate.getBoundingClientRect();
          target = {
            type: "pinned",
            id: candidateId,
            position: point.y < bounds.top + bounds.height / 2 ? "before" : "after",
          };
        }
      }
      const nextTarget = target;
      if (!sameTarget(previousTarget, nextTarget)) {
        actionsRef.current.onDayDropTargetChange(nextTarget?.type === "day" ? nextTarget : null);
      }
      setPreview((current) => current && !sameTarget(current.target, nextTarget)
          ? { ...current, target: nextTarget }
          : current);
    };

    const scroll = (time: number) => {
      const dayList = document.elementFromPoint(point.x, point.y)?.closest<HTMLElement>("[data-daily-todo-list]");
      const container = dayList?.closest<HTMLElement>(".app-body") ?? list;
      const bounds = container.getBoundingClientRect();
      const edge = Math.min(SCROLL_EDGE, bounds.height / 3);
      let speed = 0;
      if (edge > 0 && point.x >= bounds.left && point.x <= bounds.right &&
          point.y >= bounds.top - edge && point.y <= bounds.bottom + edge) {
        if (point.y < bounds.top + edge) speed = -Math.min(1, (bounds.top + edge - point.y) / edge);
        else if (point.y > bounds.bottom - edge) speed = Math.min(1, (point.y - bounds.bottom + edge) / edge);
      }
      const previousScroll = container.scrollTop;
      container.scrollTop += speed * Math.min(time - (lastFrameTime || time), 32) * 0.5;
      lastFrameTime = time;
      if (container.scrollTop !== previousScroll) updateTarget();
      frameId = window.requestAnimationFrame(scroll);
    };

    const dispose = () => {
      window.clearTimeout(timer);
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", cancelPointer);
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("scroll", handleScroll, true);
      actionsRef.current.onDayDropTargetChange(null);
      document.body.classList.remove("is-daily-pinned-dragging");
      sessionRef.current = null;
    };
    const cancel = () => {
      dispose();
      setPreview(null);
    };
    const handleScroll = () => {
      if (active) updateTarget();
    };
    const move = (nextEvent: globalThis.PointerEvent) => {
      if (nextEvent.pointerId !== pointerId) return;
      const previousY = point.y;
      point = { x: nextEvent.clientX, y: nextEvent.clientY };
      if (!active) {
        if (scrolling || Math.hypot(point.x - startX, point.y - startY) > CANCEL_DISTANCE) {
          if (nextEvent.pointerType === "touch") {
            window.clearTimeout(timer);
            nextEvent.preventDefault();
            list.scrollTop += (scrolling ? previousY : startY) - point.y;
            scrolling = true;
            suppressClickRef.current = true;
          } else {
            cancel();
          }
        }
        return;
      }
      nextEvent.preventDefault();
      setPreview((current) => current && { ...current, x: point.x - offsetX, y: point.y - offsetY });
      updateTarget();
    };
    const end = (nextEvent: globalThis.PointerEvent) => {
      if (nextEvent.pointerId !== pointerId) return;
      if (active) {
        nextEvent.preventDefault();
        point = { x: nextEvent.clientX, y: nextEvent.clientY };
        updateTarget();
        if (target?.type === "pinned") actionsRef.current.onReorder(id, target.id, target.position);
        else if (target?.type === "day") actionsRef.current.onDropToDay(id, target.target);
      }
      cancel();
    };
    const cancelPointer = (nextEvent: globalThis.PointerEvent) => {
      if (nextEvent.pointerId === pointerId) cancel();
    };
    const keyDown = (nextEvent: KeyboardEvent) => {
      if (nextEvent.key === "Escape") {
        nextEvent.preventDefault();
        cancel();
      }
    };
    const timer = window.setTimeout(() => {
      active = true;
      suppressClickRef.current = true;
      document.body.classList.add("is-daily-pinned-dragging");
      setPreview({ id, x: rect.left, y: rect.top, width: rect.width, target: null });
      frameId = window.requestAnimationFrame(scroll);
    }, LONG_PRESS_MS);

    sessionRef.current = { id, dispose, cancel };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", cancelPointer);
    window.addEventListener("keydown", keyDown);
    window.addEventListener("blur", cancel);
    window.addEventListener("scroll", handleScroll, true);
  };

  const onClickCapture = (event: MouseEvent<HTMLElement>) => {
    if (!suppressClickRef.current || event.detail === 0) return;
    suppressClickRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  };
  const onPointerDownCapture = () => {
    if (!sessionRef.current) suppressClickRef.current = false;
  };

  return { listRef, preview, start, onClickCapture, onPointerDownCapture };
}
