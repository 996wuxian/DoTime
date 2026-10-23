import { useLayoutEffect, useRef, type RefObject } from "react";
import { invoke } from "@tauri-apps/api/core";
import gsap from "gsap";
import {
  coveringPinnedWindowFrame,
  pinnedShellOffset,
  pinnedWindowCanvas,
  pinnedWindowClip,
  samePinnedFrame,
  type PinnedWindowFrame,
  type PinnedWindowFrameTarget,
} from "../utils/pinnedWindowFrame";

type Options = {
  shellRef: RefObject<HTMLElement | null>;
  identity: string | undefined;
  expanded: boolean;
  measure: () => Promise<PinnedWindowFrameTarget | null>;
  onReady: () => Promise<void>;
};

export function usePinnedWindowFrame({ shellRef, identity, expanded, measure, onReady }: Options) {
  // Serialize native clipping and fallback geometry changes when a hover
  // reverses. Each new tween starts at the visible shell's current size.
  const queueRef = useRef(Promise.resolve());
  const readyIdentityRef = useRef<string | undefined>(undefined);
  const clipRef = useRef<PinnedWindowFrame | null>(null);

  useLayoutEffect(() => {
    const shell = shellRef.current;
    if (!shell || !identity) {
      readyIdentityRef.current = undefined;
      clipRef.current = null;
      return;
    }
    let disposed = false;
    let tween: gsap.core.Tween | undefined;
    const enqueue = (action: () => Promise<void>) => {
      queueRef.current = queueRef.current.then(action).catch((error) => {
        console.error("failed to animate pinned window frame", error);
      });
    };
    enqueue(async () => {
      if (disposed) return;
      const target = await measure();
      if (disposed || !target) return;
      const firstFrame = readyIdentityRef.current !== identity;
      const bounds = shell.getBoundingClientRect();
      const start = firstFrame ? target : {
        x: target.startX + bounds.left,
        y: target.startY + bounds.top,
        width: bounds.width,
        height: bounds.height,
      };
      const native = { x: target.startX, y: target.startY, width: target.startWidth, height: target.startHeight };
      const canvas = pinnedWindowCanvas(native, start, target);
      const setClip = async (frame: PinnedWindowFrame) => {
        const clip = pinnedWindowClip(frame, canvas);
        if (clipRef.current && samePinnedFrame(clipRef.current, clip)) return;
        await invoke("set_pinned_window_clip", clip);
        clipRef.current = clip;
      };
      gsap.set(shell, { width: start.width, height: start.height, force3D: true });
      if (!samePinnedFrame(native, canvas)) {
        await invoke("set_pinned_window_frame", canvas);
        clipRef.current = null;
      }
      // Always rebase after an awaited native mutation, even if superseded.
      // The next queued transition then measures the correct screen position.
      gsap.set(shell, { ...pinnedShellOffset(start, canvas) });
      if (target.surface) await setClip(coveringPinnedWindowFrame(start, target));
      if (disposed) return;
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (firstFrame) {
        // Register readiness before awaiting native show. A layout notification
        // can cancel this effect while that call is in flight; it must not cause
        // the next effect to hide the card and replay its entrance fade.
        readyIdentityRef.current = identity;
        gsap.set(shell, { opacity: 0, "--pinned-expansion": expanded ? 1 : 0 });
        try {
          await onReady();
        } catch (error) {
          if (readyIdentityRef.current === identity) readyIdentityRef.current = undefined;
          throw error;
        }
        if (disposed) return;
        tween = gsap.to(shell, {
          opacity: 1,
          duration: reducedMotion ? 0 : 0.16,
          ease: "power2.out",
        });
        return;
      }
      const finish = () => enqueue(async () => {
        if (disposed) return;
        if (target.surface) {
          await setClip(target);
        } else if (!samePinnedFrame(canvas, target)) {
          await invoke("set_pinned_window_frame", {
            x: target.x, y: target.y, width: target.width, height: target.height,
          });
          gsap.set(shell, { x: 0, y: 0 });
        }
      });
      if (samePinnedFrame(start, target) && Number(gsap.getProperty(shell, "opacity")) >= 0.999 &&
          Math.abs(Number(gsap.getProperty(shell, "--pinned-expansion")) - (expanded ? 1 : 0)) < 0.001) {
        finish();
        return;
      }
      tween = gsap.to(shell, {
        opacity: 1,
        width: target.width,
        height: target.height,
        ...pinnedShellOffset(target, canvas),
        "--pinned-expansion": expanded ? 1 : 0,
        duration: reducedMotion ? 0 : 0.24,
        ease: "power2.out",
        force3D: true,
        onComplete: finish,
      });
    });
    return () => {
      disposed = true;
      tween?.kill();
    };
  }, [shellRef, identity, expanded, measure, onReady]);
}
