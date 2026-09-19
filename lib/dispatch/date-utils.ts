import type { DispatchDay } from "./mock-data";

const dispatchDayOffsets: Record<DispatchDay, number> = {
  monday: 0,
  tuesday: 1,
  wednesday: 2,
  thursday: 3,
  friday: 4,
  saturday: 5,
  sunday: 6,
};

export function getWeekStartDate(date = new Date()) {
  const weekStartDate = new Date(date);
  const weekday = weekStartDate.getDay();
  const offsetToMonday = weekday === 0 ? -6 : 1 - weekday;

  weekStartDate.setDate(weekStartDate.getDate() + offsetToMonday);
  weekStartDate.setHours(0, 0, 0, 0);

  return weekStartDate;
}

export function addDays(date: Date, days: number) {
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + days);

  return nextDate;
}

export function getWeekEndDate(weekStartDate: Date) {
  const weekEndDate = addDays(weekStartDate, 6);
  weekEndDate.setHours(23, 59, 59, 999);

  return weekEndDate;
}

export function formatDateParam(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

export function parseWeekStartParam(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const [year, month, day] = value.split("-").map(Number);
  const parsedDate = new Date(year, month - 1, day);

  if (
    parsedDate.getFullYear() !== year ||
    parsedDate.getMonth() !== month - 1 ||
    parsedDate.getDate() !== day
  ) {
    return null;
  }

  parsedDate.setHours(0, 0, 0, 0);

  return parsedDate;
}

export function getScheduledDateForWeekDay(
  weekStartDate: Date,
  day: DispatchDay,
) {
  const scheduledDate = addDays(weekStartDate, dispatchDayOffsets[day]);
  scheduledDate.setHours(6, 0, 0, 0);

  return scheduledDate.toISOString();
}

export function formatWeekLabel(weekStartDate: Date) {
  return `Semaine du ${new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(weekStartDate)}`;
}
