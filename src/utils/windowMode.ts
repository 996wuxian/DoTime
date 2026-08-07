export const DEFAULT_WINDOW_WIDTH = 1220;
export const DEFAULT_WINDOW_HEIGHT = 720;
export const DEFAULT_MIN_WIDTH = 1220;
export const DEFAULT_MIN_HEIGHT = 560;
export const MINI_WINDOW_WIDTH = 500;
export const MINI_WINDOW_HEIGHT = 80;
export const MINI_COLLAPSED_VISIBLE_HEIGHT = 12;

let miniMoveToken = 0;

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export async function enterMiniWindowMode() {
  try {
    const {
      currentMonitor,
      getCurrentWindow,
      LogicalPosition,
      LogicalSize,
    } = await import("@tauri-apps/api/window");

    const window = getCurrentWindow();
    const monitor = await currentMonitor();
    await window.setMinSize(
      new LogicalSize(MINI_WINDOW_WIDTH, MINI_WINDOW_HEIGHT),
    );
    await window.setSize(new LogicalSize(MINI_WINDOW_WIDTH, MINI_WINDOW_HEIGHT));
    await window.setAlwaysOnTop(true);

    if (monitor) {
      const workPosition = monitor.workArea.position.toLogical(
        monitor.scaleFactor,
      );
      const workSize = monitor.workArea.size.toLogical(monitor.scaleFactor);
      await window.setPosition(
        new LogicalPosition(
          workPosition.x + (workSize.width - MINI_WINDOW_WIDTH) / 2,
          workPosition.y,
        ),
      );
    }
  } catch {
    /* browser */
  }
}

async function setMiniWindowCollapsed(collapsed: boolean) {
  const token = ++miniMoveToken;

  try {
    const { currentMonitor, getCurrentWindow, LogicalPosition } = await import(
      "@tauri-apps/api/window"
    );

    const window = getCurrentWindow();
    const monitor = await currentMonitor();
    if (!monitor) return;

    const workPosition = monitor.workArea.position.toLogical(
      monitor.scaleFactor,
    );
    const currentPosition = (await window.outerPosition()).toLogical(
      monitor.scaleFactor,
    );
    const targetY = collapsed
      ? workPosition.y - MINI_WINDOW_HEIGHT + MINI_COLLAPSED_VISIBLE_HEIGHT
      : workPosition.y;
    const startY = currentPosition.y;
    if (Math.abs(startY - targetY) < 1) return;

    for (let step = 1; step <= 8; step += 1) {
      if (token !== miniMoveToken) return;
      const progress = step / 8;
      const eased = 1 - (1 - progress) * (1 - progress);
      await window.setPosition(
        new LogicalPosition(
          currentPosition.x,
          startY + (targetY - startY) * eased,
        ),
      );
      await delay(12);
    }
  } catch {
    /* browser */
  }
}

export function collapseMiniWindowMode() {
  return setMiniWindowCollapsed(true);
}

export function revealMiniWindowMode() {
  return setMiniWindowCollapsed(false);
}

export async function ensureDefaultWindowMode() {
  try {
    const { getCurrentWindow, LogicalSize } = await import(
      "@tauri-apps/api/window"
    );

    const window = getCurrentWindow();
    await window.setAlwaysOnTop(false);
    await window.setMinSize(new LogicalSize(DEFAULT_MIN_WIDTH, DEFAULT_MIN_HEIGHT));
  } catch {
    /* browser */
  }
}

export async function exitMiniWindowMode() {
  miniMoveToken += 1;

  try {
    const { getCurrentWindow, LogicalSize } = await import(
      "@tauri-apps/api/window"
    );

    const window = getCurrentWindow();
    await window.setAlwaysOnTop(false);
    await window.setMinSize(new LogicalSize(DEFAULT_MIN_WIDTH, DEFAULT_MIN_HEIGHT));
    await window.setSize(new LogicalSize(DEFAULT_WINDOW_WIDTH, DEFAULT_WINDOW_HEIGHT));
    await window.center();
  } catch {
    /* browser */
  }
}
