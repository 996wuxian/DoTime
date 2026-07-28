/** 紧急程度 */
export type Urgency = "low" | "medium" | "high" | "critical";

export interface Todo {
  id: string;
  title: string;
  urgency: Urgency;
  /** 所属日期 YYYY-MM-DD */
  date: string;
  /** 同一天内的手动排序值，越小越靠前 */
  sortOrder: number;
  /** 计划倒计时时长（秒） */
  plannedSeconds: number;
  /** 是否启用倒计时 */
  countdownEnabled: boolean;
  /** 是否启用提醒 */
  reminderEnabled: boolean;
  /** 提醒时间 HH:mm */
  reminderTime: string | null;
  /** 是否记录耗时 */
  recordTimeEnabled: boolean;
  /** 稍后提醒时间戳 */
  reminderSnoozedUntil: number | null;
  /** 上次触发提醒的时间戳，用于避免重复弹出 */
  reminderLastFiredAt: number | null;
  /** 是否完成 */
  completed: boolean;
  /** 计时是否进行中 */
  isTiming: boolean;
  /** 本次计时开始时间戳 */
  timingStartedAt: number | null;
  /** 累计已计时秒数（不含当前进行中的片段） */
  elapsedSeconds: number;
  /** 完成时实际总耗时（秒），结束计时后写入 */
  actualDurationSeconds: number | null;
  createdAt: number;
  completedAt: number | null;
}

export const URGENCY_LABELS: Record<Urgency, string> = {
  low: "低",
  medium: "中",
  high: "高",
  critical: "紧急",
};

export const URGENCY_ORDER: Record<Urgency, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};
