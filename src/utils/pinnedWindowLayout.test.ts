import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { measurePinnedWindowLayout } from "./pinnedWindowLayout";

describe("pinned windows use the shared group layout", () => {
  let expanded: boolean;
  let scale: number;
  let commands: Array<{ command: string; args: unknown }>;

  beforeEach(() => {
    vi.stubGlobal("window", new EventTarget());
    mockWindows("pinned-todo-1");
    expanded = false;
    scale = 1;
    commands = [];
    mockIPC((command, args) => {
      commands.push({ command, args });
      if (command === "update_pinned_stack_layout") expanded = (args as { expanded: boolean }).expanded;
      if (command === "update_pinned_stack_layout" || command === "get_pinned_stack_layout") {
        return {
          slot: "1", expanded,
          parent: { x: 1710, y: 204, width: 210, height: 46 },
          subtasks: { x: 1740, y: 254, width: 180, height: 108 },
        };
      }
      if (command === "plugin:window|scale_factor") return scale;
      if (command === "plugin:window|outer_position") return { x: 1710 * scale, y: 92 * scale };
      if (command === "plugin:window|outer_size") return { width: 210 * scale, height: 46 * scale };
    });
  });

  afterEach(() => { clearMocks(); vi.unstubAllGlobals(); });

  it.each([1, 1.5, 2])("moves an existing parent below the preceding group's children at scale %s", async (factor) => {
    scale = factor;
    const frame = await measurePinnedWindowLayout("parent", {
      slot: "1", todoId: "second", expanded: false, subtaskTotal: 2,
    });
    expect(frame).toMatchObject({ y: 204, startY: 92, startWidth: 210 });
    expect(commands.find((call) => call.command === "update_pinned_stack_layout")?.args)
      .toEqual({ slot: "1", todoId: "second", expanded: false, subtaskTotal: 2 });
  });

  it("positions children from the same layout instead of reading a moving parent's native bounds", async () => {
    expect(await measurePinnedWindowLayout("subtasks", { slot: "1", expanded: false }))
      .toMatchObject({ x: 1740, y: 254, width: 180, height: 108 });
    expect(commands.filter((call) => call.command === "update_pinned_stack_layout")).toHaveLength(0);
  });

  it("waits for the parent's expanded layout instead of applying stale dimensions", async () => {
    expect(await measurePinnedWindowLayout("subtasks", { slot: "1", expanded: true })).toBeNull();
    expanded = true;
    expect(await measurePinnedWindowLayout("subtasks", { slot: "1", expanded: true })).not.toBeNull();
  });
});
