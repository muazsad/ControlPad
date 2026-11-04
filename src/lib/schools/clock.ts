// Client-safe. A school's local date and minutes-after-midnight at `now`.
export function localClock(now: Date, timeZone: string): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    minutes: Number(value("hour")) * 60 + Number(value("minute")),
  };
}

export function localDate(now: Date, timeZone: string): string {
  return localClock(now, timeZone).date;
}

/** The UTC instant for a school-local date and "HH:MM" time, DST-aware. */
export function localTimeToUtc(date: string, time: string, timeZone: string): Date {
  const target = Date.parse(`${date}T${time}:00.000Z`); // the wall-clock time, as if UTC
  let guess = target;
  for (let i = 0; i < 3; i += 1) {
    const clock = localClock(new Date(guess), timeZone);
    const shown = Date.parse(`${clock.date}T00:00:00.000Z`) + clock.minutes * 60_000;
    const diff = target - shown;
    if (diff === 0) break;
    guess += diff;
  }
  return new Date(guess);
}
