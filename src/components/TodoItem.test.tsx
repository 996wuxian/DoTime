import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TodoItem } from "./TodoItem";
import type { Todo, TodoSubtask } from "../types";
import type { ComponentProps } from "react";

const now = Date.now();
const subtask: TodoSubtask = {
  id: "child", title: "核对明细", urgency: "medium", plannedSeconds: 0,
  countdownEnabled: false, recordTimeEnabled: true, completed: false,
  isTiming: false, timingStartedAt: null, elapsedSeconds: 0,
  actualDurationSeconds: null, createdAt: now, completedAt: null, children: [],
};
const todo: Todo = {
  id: "task", title: "整理账单", date: "2026-10-22", urgency: "medium", sortOrder: 1000,
  plannedSeconds: 300, countdownEnabled: false, recordTimeEnabled: true,
  reminderEnabled: false, reminderTime: null, reminderSnoozedUntil: null, reminderLastFiredAt: null,
  completed: false, isTiming: false, timingStartedAt: null, elapsedSeconds: 60,
  actualDurationSeconds: null, createdAt: now, completedAt: null,
  recurrenceSeriesId: null, recurrence: null, recurrenceTemplate: null,
};
function render(overrides: Partial<Todo> = {}, props: Partial<ComponentProps<typeof TodoItem>> = {}) {
  const noop = vi.fn();
  return renderToStaticMarkup(<TodoItem
    todo={{ ...todo, ...overrides }} liveElapsed={60} remaining={240}
    onStart={noop} onPause={noop} onStop={noop} onToggle={noop} onRemove={noop} onEdit={noop} onReset={noop}
    onUpdateComment={noop} onUpdateImages={noop} onToggleFavorite={noop} onPin={noop}
    onAddSubtask={noop} onEditSubtask={noop} onSyncSubtask={noop} onToggleSubtask={noop} onRemoveSubtask={noop}
    onReorderSubtask={noop} onStartSubtask={noop} onPauseSubtask={noop} onStopSubtask={noop}
    onDragHandlePointerDown={noop} {...props}
  />);
}

describe("简洁任务卡片", () => {
  it("保留完成、编辑、开始计时和排序入口，低频操作收进更多菜单", () => {
    const html = render();
    for (const label of ["标记完成", "编辑待办", "开始待办计时", "拖拽排序", "待办更多操作"]) {
      expect(html).toContain(`aria-label="${label}"`);
    }
    for (const label of ["添加子待办", "添加评论", "收藏待办", "删除待办", "重置倒计时和计时", "待开始"]) {
      expect(html).not.toContain(label);
    }
    expect(html).toContain('aria-haspopup="menu"');
  });

  it("计时中的卡片保留暂停入口，已结束的耗时只显示一次", () => {
    const running = render({ isTiming: true, timingStartedAt: now });
    expect(running).toContain('aria-label="暂停待办计时"');
    expect(running).not.toContain('aria-label="开始待办计时"');
    const finished = render({ completed: true, completedAt: now, actualDurationSeconds: 60 });
    expect(finished).toContain("完成耗时");
    expect(finished).not.toContain("已用 ");
    expect(finished).not.toContain('aria-label="开始待办计时"');
  });

  it("已完成卡片默认收起子任务、图片和评论，保留进度和展开入口", () => {
    const html = render({ completed: true, completedAt: now, subtasks: [subtask], comment: "保留付款回执",
      images: [{ id: "bill", name: "账单图", dataUrl: "data:image/png;base64,AA==" }] });
    expect(html).toContain('aria-label="展开已完成待办详情"');
    expect(html).toContain('aria-label="展开子待办"');
    expect(html).not.toContain("核对明细");
    expect(html).not.toContain("保留付款回执");
    expect(html).not.toContain('aria-label="待办图片"');
    expect(html).toContain('aria-label="标记未完成"');
  });

  it("搜索定位已完成任务时展示详情，普通任务继续显示子任务和评论", () => {
    for (const html of [
      render({ completed: true, completedAt: now, subtasks: [subtask], comment: "保留付款回执" }, { isHighlighted: true }),
      render({ subtasks: [subtask], comment: "保留付款回执" }),
    ]) {
      expect(html).toContain("核对明细");
      expect(html).toContain("保留付款回执");
      expect(html).toContain('aria-label="子待办更多操作"');
      expect(html).not.toContain('aria-label="删除子待办"');
    }
  });

  it("没有附加内容的已完成任务不显示空详情入口，收藏和固定状态仍可见", () => {
    const html = render({ completed: true, completedAt: now, favorite: true }, { isPinned: true });
    expect(html).not.toContain("已完成待办详情");
    expect(html).toContain('aria-label="已收藏"');
    expect(html).toContain('aria-label="已固定到窗口"');
  });
});
