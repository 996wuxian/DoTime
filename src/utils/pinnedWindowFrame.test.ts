import { describe, expect, it } from "vitest";
import {
  coveringPinnedWindowFrame, pinnedShellOffset, pinnedWindowCanvas, pinnedWindowClip,
  samePinnedFrame, type PinnedWindowFrame, type PinnedWindowFrameTarget,
} from "./pinnedWindowFrame";

function expectInside(inner: PinnedWindowFrame, outer: PinnedWindowFrame) {
  expect(inner.x).toBeGreaterThanOrEqual(outer.x);
  expect(inner.y).toBeGreaterThanOrEqual(outer.y);
  expect(inner.x + inner.width).toBeLessThanOrEqual(outer.x + outer.width);
  expect(inner.y + inner.height).toBeLessThanOrEqual(outer.y + outer.height);
}

describe("pinned window animation canvas", () => {
  const collapsed = { x: 1710, y: 18, width: 210, height: 46 };
  const expanded = { x: 1500, y: 18, width: 420, height: 60 };

  it.each([[collapsed, expanded], [expanded, collapsed]])(
    "keeps the full visible card inside the WebView throughout a transition",
    (start, end) => {
      const canvas = coveringPinnedWindowFrame(start, end);
      for (let progress = 0; progress <= 1; progress += 0.1) {
        const frame = Object.fromEntries(Object.keys(start).map((key) => {
          const field = key as keyof PinnedWindowFrame;
          return [key, start[field] + (end[field] - start[field]) * progress];
        })) as PinnedWindowFrame;
        expectInside(frame, canvas);
        const offset = pinnedShellOffset(frame, canvas);
        expect(canvas.x + canvas.width - frame.width + offset.x).toBeCloseTo(frame.x);
        expect(canvas.y + offset.y).toBeCloseTo(frame.y);
      }
    },
  );

  it("can reverse at an intermediate visible size without jumping to the native window size", () => {
    const interrupted = { x: 1600.5, y: 18, width: 319.5, height: 53.5 };
    const canvas = coveringPinnedWindowFrame(interrupted, collapsed);
    expect(canvas.width).toBe(319.5);
    expectInside(interrupted, canvas);
    expectInside(collapsed, canvas);
    expect(pinnedShellOffset(interrupted, canvas)).toEqual({ x: 0, y: 0 });
  });

  it("contains child windows that change from below to above the parent on a negative-coordinate monitor", () => {
    const below = { x: -180, y: 750, width: 180, height: 162 };
    const above = { x: -380, y: 380, width: 380, height: 310 };
    const canvas = coveringPinnedWindowFrame(below, above);
    expectInside(below, canvas);
    expectInside(above, canvas);
    expect(pinnedShellOffset(below, canvas)).toEqual({ x: 0, y: 370 });
    expect(pinnedShellOffset(above, canvas)).toEqual({ x: 0, y: 0 });
  });

  it("keeps the native viewport unchanged through repeated expand/collapse and group reflow", () => {
    const native = { x: 1500, y: 0, width: 420, height: 1040 };
    let visible: PinnedWindowFrame = collapsed;
    for (const end of [expanded, collapsed, { ...expanded, y: 250 }, { ...collapsed, y: 92 }, expanded, collapsed]) {
      const target: PinnedWindowFrameTarget = {
        ...end, startX: native.x, startY: native.y,
        startWidth: native.width, startHeight: native.height, surface: native,
      };
      const canvas = pinnedWindowCanvas(native, visible, target);
      expect(samePinnedFrame(canvas, native)).toBe(true);
      expectInside(visible, canvas);
      expectInside(end, canvas);
      const clip = pinnedWindowClip(end, canvas);
      // The final clip follows only the card; empty retained pixels cannot
      // cover another pinned group or intercept clicks on the desktop.
      expect(clip.width).toBe(end.width);
      expect(clip.height).toBe(end.height);
      expect(clip.x + canvas.x).toBe(end.x);
      expect(clip.y + canvas.y).toBe(end.y);
      visible = end;
    }
  });

  it("retains the enlarged surface when moving across columns instead of shrinking it at the end", () => {
    const native = { x: 1500, y: 0, width: 420, height: 1040 };
    const target: PinnedWindowFrameTarget = {
      ...collapsed, x: 1262, startX: native.x, startY: native.y,
      startWidth: native.width, startHeight: native.height,
      surface: { ...native, x: 1052 },
    };
    const canvas = pinnedWindowCanvas(native, collapsed, target);
    expectInside(native, canvas);
    expectInside(target, canvas);
    const nextTarget = { ...target, ...expanded, surface: native };
    expect(pinnedWindowCanvas(canvas, target, nextTarget)).toEqual(canvas);
  });
});
