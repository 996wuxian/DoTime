import { describe, expect, it } from "vitest";
import type { TodoDraftSnapshot } from "../types";
import { createDefaultTodoDraft, getDraftExtras, prepareTodoDraft } from "./todoDraft";

function snapshot(): TodoDraftSnapshot {
  return { draft: createDefaultTodoDraft("2026-10-22"), countdownTargetTime: "17:00", countdownTimeTouched: false };
}

describe("quick and detailed task creation", () => {
  it("creates an ordinary task from a title without requiring timing settings", () => {
    const input = snapshot();
    input.draft.title = "  写下要做的事  ";
    const result = prepareTodoDraft(input);
    expect(result).toMatchObject({ title: "写下要做的事", date: "2026-10-22", countdownEnabled: false, recordTimeEnabled: false, reminderTime: null });
  });

  it("preserves images, notes, subtasks and repetition when a detailed draft is added from the quick input", () => {
    const input = snapshot();
    Object.assign(input.draft, {
      title: "保留详细设置", comment: "任务说明", subtaskTitles: "第一步\n第二步",
      images: [{ id: "image-1", name: "图.png", dataUrl: "data:image/png;base64,AAAA" }],
      recurrence: { frequency: "daily", weekdays: [], monthDay: null, endDate: null },
      urgency: "high", reminderEnabled: true, reminderTime: "16:30",
    });

    expect(prepareTodoDraft(input)).toMatchObject(input.draft);
    expect(input.draft.title).toEqual("保留详细设置");
  });

  it("uses the selected end time for a custom countdown", () => {
    const input = snapshot();
    input.draft.countdownEnabled = true;
    input.draft.plannedSeconds = 3600;
    input.countdownTimeTouched = true;
    const now = new Date(2026, 9, 22, 16, 45).getTime();
    expect(prepareTodoDraft(input, now)).toMatchObject({ plannedSeconds: 900, recordTimeEnabled: true });
  });

  it("retains duration presets instead of using their old estimated end time", () => {
    const input = snapshot();
    input.draft.countdownEnabled = true;
    input.draft.plannedSeconds = 1800;
    expect(prepareTodoDraft(input, new Date(2026, 9, 22, 18, 0).getTime()).plannedSeconds).toEqual(1800);
  });

  it("does not enable automatic completion or a reminder when their parent setting is off", () => {
    const input = snapshot();
    input.draft.countdownOnlyEnabled = true;
    input.draft.reminderTime = "16:30";
    expect(prepareTodoDraft(input)).toMatchObject({ countdownOnlyEnabled: false, reminderTime: null });
  });

  it("shows the optional settings that will be carried over with a draft", () => {
    const input = snapshot();
    input.draft.comment = "备注";
    input.draft.subtaskTitles = "第一步\n\n第二步";
    input.draft.reminderEnabled = true;
    input.draft.reminderTime = "16:30";
    expect(getDraftExtras(input.draft)).toEqual(["提醒 16:30", "有备注", "2 个子待办"]);
  });
});
