import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { deleteStickyNote, listStickyNotes, STICKY_NOTES_CHANGED_EVENT, updateStickyNote, type StickyNote } from "./stickyNotes";

const storageKey = "dotime-sticky-notes-v1";
const makeNote = (id: string): StickyNote => ({
  id, html: `<b>${id}</b>`, color: "yellow", pinned: false, open: true, createdAt: 1, updatedAt: 1,
});

describe("便签列表删除", () => {
  let values: Map<string, string>;
  let closeWindow: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    values = new Map([[storageKey, JSON.stringify([makeNote("current"), makeNote("other")])]]);
    closeWindow = vi.fn();
    vi.stubGlobal("isTauri", false);
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    });
    vi.stubGlobal("window", Object.assign(new EventTarget(), {
      location: { search: "?view=sticky-note&noteId=current" },
      close: closeWindow,
    }));
  });

  afterEach(() => {
    clearMocks();
    vi.unstubAllGlobals();
  });

  it("删除其他便签时保留当前便签和窗口，并通知列表刷新", async () => {
    const changed = vi.fn();
    window.addEventListener(STICKY_NOTES_CHANGED_EVENT, changed);

    await deleteStickyNote("other");

    expect(await listStickyNotes()).toEqual([makeNote("current")]);
    expect(closeWindow).not.toHaveBeenCalled();
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it("删除当前便签时只关闭当前窗口，保留其他便签", async () => {
    await deleteStickyNote("current");

    expect(await listStickyNotes()).toEqual([makeNote("other")]);
    expect(closeWindow).toHaveBeenCalledTimes(1);
  });

  it("保存中的旧内容不能重新创建已删除的便签", async () => {
    await deleteStickyNote("other");

    await expect(updateStickyNote("other", { html: "过期内容" })).rejects.toThrow("已被删除");
    expect(await listStickyNotes()).toEqual([makeNote("current")]);
  });

  it("写入失败时报告错误，并保留便签和窗口", async () => {
    vi.spyOn(localStorage, "setItem").mockImplementationOnce(() => { throw new Error("磁盘已满"); });

    await expect(deleteStickyNote("current")).rejects.toThrow("磁盘已满");
    expect(await listStickyNotes()).toEqual([makeNote("current"), makeNote("other")]);
    expect(closeWindow).not.toHaveBeenCalled();
  });

  it("桌面命令使用所选便签的标识，不依赖发起删除的窗口", async () => {
    vi.stubGlobal("isTauri", true);
    const requests: { command: string; payload: unknown }[] = [];
    mockIPC((command, payload) => { requests.push({ command, payload }); });

    await deleteStickyNote("other");

    expect(requests).toEqual([{ command: "delete_sticky_note", payload: { id: "other" } }]);
    expect(closeWindow).not.toHaveBeenCalled();
  });
});
