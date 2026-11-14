export interface LiveClassSchedule {
  start_at: string | null;
  end_at: string | null;
  class_date: string | null;
  start_time: string | null;
  duration_minutes: number | null;
}

export function parseScheduledStart(
  liveClass: LiveClassSchedule,
  timeZone: string,
): number | null {
  if (liveClass.start_at !== null) {
    const timestamp = Date.parse(liveClass.start_at);
    return Number.isFinite(timestamp) ? timestamp : null;
  }
  if (!liveClass.class_date || !liveClass.start_time ||
    !/^\d{4}-\d{2}-\d{2}$/.test(liveClass.class_date) ||
    !/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,6})?)?$/.test(liveClass.start_time)) {
    return null;
  }
  const [year, month, day] = liveClass.class_date.split("-").map(Number);
  const [hour, minute, second = "0"] = liveClass.start_time.split(":");
  const [wholeSecond, fractionalSecond = ""] = second.split(".");
  const milliseconds = Number(`0.${fractionalSecond || "0"}`) * 1000;
  const targetTimestamp = Date.UTC(
    year,
    month - 1,
    day,
    Number(hour),
    Number(minute),
    Number(wholeSecond),
    milliseconds,
  );
  if (!Number.isFinite(targetTimestamp) ||
    new Date(targetTimestamp).toISOString().slice(0, 10) !== liveClass.class_date) return null;

  let timestamp = targetTimestamp;
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
  } catch {
    return null;
  }
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = Object.fromEntries(
      formatter.formatToParts(timestamp)
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, Number(part.value)]),
    );
    const representedTimestamp = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
      milliseconds,
    );
    const difference = representedTimestamp - targetTimestamp;
    if (difference === 0) return timestamp;
    timestamp -= difference;
  }
  return null;
}

export function parseScheduledEnd(
  liveClass: LiveClassSchedule,
  start: number | null,
): number | null {
  if (liveClass.end_at !== null) {
    const timestamp = Date.parse(liveClass.end_at);
    return Number.isFinite(timestamp) ? timestamp : null;
  }
  const durationMinutes = Number(liveClass.duration_minutes);
  if (start === null || !Number.isFinite(durationMinutes) || durationMinutes <= 0) {
    return null;
  }
  return start + durationMinutes * 60_000;
}
