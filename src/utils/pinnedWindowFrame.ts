export type PinnedWindowFrame = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PinnedWindowFrameTarget = PinnedWindowFrame & {
  startX: number;
  startY: number;
  startWidth: number;
  startHeight: number;
  surface?: PinnedWindowFrame;
};

// Keep both ends inside the native WebView until the content finishes moving.
// Shrinking the native window first would clip the entire collapse animation.
export function coveringPinnedWindowFrame(
  start: PinnedWindowFrame,
  end: PinnedWindowFrame,
): PinnedWindowFrame {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  return {
    x,
    y,
    width: Math.max(start.x + start.width, end.x + end.width) - x,
    height: Math.max(start.y + start.height, end.y + end.height) - y,
  };
}

export function pinnedShellOffset(shell: PinnedWindowFrame, native: PinnedWindowFrame) {
  return {
    x: shell.x + shell.width - native.x - native.width,
    y: shell.y - native.y,
  };
}

export function samePinnedFrame(a: PinnedWindowFrame, b: PinnedWindowFrame) {
  return Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01 &&
    Math.abs(a.width - b.width) < 0.01 && Math.abs(a.height - b.height) < 0.01;
}

export function pinnedWindowCanvas(
  native: PinnedWindowFrame,
  start: PinnedWindowFrame,
  target: PinnedWindowFrameTarget,
) {
  // On Windows, retain the full viewport across transitions. Moving the clip
  // cannot invalidate WebView2's back buffer the way resizing its HWND can.
  return target.surface
    ? coveringPinnedWindowFrame(native, coveringPinnedWindowFrame(target.surface, target))
    : coveringPinnedWindowFrame(start, target);
}

export function pinnedWindowClip(frame: PinnedWindowFrame, canvas: PinnedWindowFrame): PinnedWindowFrame {
  return { x: frame.x - canvas.x, y: frame.y - canvas.y, width: frame.width, height: frame.height };
}
