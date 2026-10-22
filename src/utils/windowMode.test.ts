import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { enterMiniWindowMode, exitMiniWindowMode } from "./windowMode";
import { loadWindowOpacity, saveWindowOpacity } from "./windowOpacity";

describe("floating window opacity across mode changes", () => {
  let nativeOpacity: number;
  let commands: string[];

  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
    vi.stubGlobal("window", new EventTarget());
    nativeOpacity = 1;
    commands = [];
    mockWindows("main");
    // Keep the real window-mode and preference code; replace only native IPC.
    mockIPC((command, payload) => {
      commands.push(command);
      if (command === "plugin:window|current_monitor") {
        return {
          name: "test-monitor", scaleFactor: 1,
          position: { x: 0, y: 0 }, size: { width: 1920, height: 1080 },
          workArea: { position: { x: 0, y: 0 }, size: { width: 1920, height: 1040 } },
        };
      }
      // Windows style changes clear the native layered-window opacity.
      if (command.startsWith("plugin:window|")) nativeOpacity = 1;
      if (command === "set_window_opacity") {
        nativeOpacity = (payload as { opacity: number }).opacity;
      }
    });
  });

  afterEach(() => {
    clearMocks();
    vi.unstubAllGlobals();
  });

  it.each([0.35, 0.6, 1])("restores %s opacity after exiting and re-entering top mode", async (opacity) => {
    saveWindowOpacity(opacity);

    await enterMiniWindowMode();
    expect(nativeOpacity).toEqual(opacity);
    expect(commands[commands.length - 1]).toEqual("set_window_opacity");

    await exitMiniWindowMode();
    expect(nativeOpacity).toEqual(1);
    expect(loadWindowOpacity()).toEqual(opacity);

    await enterMiniWindowMode();
    expect(nativeOpacity).toEqual(opacity);
    expect(loadWindowOpacity()).toEqual(opacity);
  });

  it("reads the latest saved preference when pinning again", async () => {
    saveWindowOpacity(0.6);
    await enterMiniWindowMode();
    await exitMiniWindowMode();
    saveWindowOpacity(0.8);

    await enterMiniWindowMode();

    expect(nativeOpacity).toEqual(0.8);
    expect(commands[commands.length - 1]).toEqual("set_window_opacity");
  });
});
