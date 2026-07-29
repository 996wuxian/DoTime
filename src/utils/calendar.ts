import { formatDateKey } from "./time";

export type CalendarDay = {
  dateKey: string;
  day: number;
  isCurrentMonth: boolean;
};

export function parseDateKey(dateKey: string): Date {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function getMonthStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function shiftMonth(date: Date, delta: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1);
}

export function shiftDateKey(dateKey: string, delta: number): string {
  const date = parseDateKey(dateKey);
  date.setDate(date.getDate() + delta);
  return formatDateKey(date);
}

export function getCalendarDays(viewMonth: Date): CalendarDay[] {
  const monthStart = getMonthStart(viewMonth);
  const mondayOffset = (monthStart.getDay() + 6) % 7;
  const firstDate = new Date(
    monthStart.getFullYear(),
    monthStart.getMonth(),
    1 - mondayOffset,
  );

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(firstDate);
    date.setDate(firstDate.getDate() + index);
    return {
      dateKey: formatDateKey(date),
      day: date.getDate(),
      isCurrentMonth:
        date.getFullYear() === monthStart.getFullYear() &&
        date.getMonth() === monthStart.getMonth(),
    };
  });
}
