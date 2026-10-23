import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { PinnedWindowFrame, PinnedWindowFrameTarget } from "./pinnedWindowFrame";

export const PINNED_LAYOUT_UPDATED_EVENT = "dotime-pinned-layout-updated";

type Placement = {
  slot: string;
  expanded: boolean;
  parent: PinnedWindowFrame;
  subtasks: PinnedWindowFrame | null;
  parentSurface?: PinnedWindowFrame | null;
  subtasksSurface?: PinnedWindowFrame | null;
};

type Request = {
  slot: string;
  expanded: boolean;
  todoId?: string;
  subtaskTotal?: number;
};

export async function measurePinnedWindowLayout(
  kind: "parent" | "subtasks",
  request: Request,
): Promise<PinnedWindowFrameTarget | null> {
  const current = getCurrentWindow();
  const [placement, scale, size, position] = await Promise.all([
    invoke<Placement | null>(kind === "parent" ? "update_pinned_stack_layout" : "get_pinned_stack_layout",
      kind === "parent" ? request : { slot: request.slot }),
    current.scaleFactor(), current.outerSize(), current.outerPosition(),
  ]);
  // The parent owns the group state. A child waits for its corresponding layout
  // event instead of animating with the previous group's dimensions.
  if (!placement || placement.expanded !== request.expanded) return null;
  const frame = placement[kind];
  if (!frame) return null;
  const start = position.toLogical(scale);
  const startSize = size.toLogical(scale);
  return {
    ...frame,
    startX: start.x, startY: start.y,
    startWidth: startSize.width, startHeight: startSize.height,
    surface: (kind === "parent" ? placement.parentSurface : placement.subtasksSurface) ?? undefined,
  };
}
