import { dayKeyInZone, hourInZone, weekdayInZone } from './scheduler.js';
const DAY = 86400000;
export function resetWindow(date = new Date(), { timeZone = 'Europe/Amsterdam', afterHour = 10, recoveryDays = 2 } = {}) {
  const day = dayKeyInZone(date, timeZone);
  const weekday = weekdayInZone(date, timeZone);
  let daysAfterMonday = weekday - 1;
  const hour = hourInZone(date, timeZone);
  const key = new Date(Date.parse(`${day}T12:00:00Z`) - daysAfterMonday * DAY).toISOString().slice(0, 10);
  return { key, open: (daysAfterMonday === 0 ? hour >= afterHour : daysAfterMonday < recoveryDays) };
}
