// Minimal, dependency-free 5-field cron parser: validation + next-run computation.
// Standard fields: minute hour day-of-month month day-of-week (0 and 7 both = Sunday).

const FIELD_RANGES = {
  minute: [0, 59],
  hour: [0, 23],
  dayOfMonth: [1, 31],
  month: [1, 12],
  dayOfWeek: [0, 7],
};

function parseField(raw, name) {
  const [min, max] = FIELD_RANGES[name];
  const values = new Set();
  for (const part of raw.split(",")) {
    const m = part.match(/^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/);
    if (!m) throw new Error(`invalid ${name} field "${part}" in schedule`);
    const [, range, stepRaw] = m;
    const step = stepRaw ? Number(stepRaw) : 1;
    if (step < 1) throw new Error(`invalid step "${stepRaw}" in ${name} field`);
    let start = min;
    let end = max;
    if (range !== "*") {
      if (range.includes("-")) {
        [start, end] = range.split("-").map(Number);
      } else {
        start = end = Number(range);
      }
    }
    if (start < min || end > max || start > end) {
      throw new Error(`${name} value out of range (${min}-${max}): "${part}"`);
    }
    for (let v = start; v <= end; v += step) {
      values.add(name === "dayOfWeek" && v === 7 ? 0 : v);
    }
  }
  return values;
}

export function parseSchedule(schedule) {
  const fields = schedule.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(
      `expected 5 fields (minute hour day-of-month month day-of-week), got ${fields.length}: "${schedule}"`
    );
  }
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
  return {
    minute: parseField(minute, "minute"),
    hour: parseField(hour, "hour"),
    dayOfMonth: parseField(dayOfMonth, "dayOfMonth"),
    month: parseField(month, "month"),
    dayOfWeek: parseField(dayOfWeek, "dayOfWeek"),
    dayOfMonthRestricted: dayOfMonth !== "*",
    dayOfWeekRestricted: dayOfWeek !== "*",
  };
}

export function isValidSchedule(schedule) {
  if (typeof schedule !== "string" || !schedule.trim()) {
    return { valid: false, error: "schedule is empty" };
  }
  try {
    parseSchedule(schedule);
    return { valid: true };
  } catch (e) {
    return { valid: false, error: e.message };
  }
}

const WEEKDAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

// Reads the wall-clock minute/hour/day/month/weekday for a UTC instant in `timezone`.
function wallClockParts(date, timezone) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  return {
    minute: Number(parts.minute),
    hour: parts.hour === "24" ? 0 : Number(parts.hour),
    dayOfMonth: Number(parts.day),
    month: Number(parts.month),
    dayOfWeek: WEEKDAY_INDEX[parts.weekday],
  };
}

function fieldsMatch(parsed, wc) {
  const domOk = parsed.dayOfMonth.has(wc.dayOfMonth);
  const dowOk = parsed.dayOfWeek.has(wc.dayOfWeek);
  // Cron semantics: if both day-of-month and day-of-week are restricted, either matching is enough.
  const dayOk =
    parsed.dayOfMonthRestricted && parsed.dayOfWeekRestricted ? domOk || dowOk : domOk && dowOk;
  return parsed.minute.has(wc.minute) && parsed.hour.has(wc.hour) && parsed.month.has(wc.month) && dayOk;
}

const MAX_LOOKAHEAD_MINUTES = 60 * 24 * 366 * 2; // ~2 years

// Returns the next `count` run times (Date objects, real UTC instants) for a schedule,
// strictly after `from` (defaults to now), evaluated in `timezone` (defaults to UTC).
export function nextRuns(schedule, { timezone = "UTC", count = 5, from } = {}) {
  const parsed = parseSchedule(schedule);
  const start = from ? new Date(from) : new Date();
  let candidate = new Date(Math.ceil((start.getTime() + 1) / 60000) * 60000);
  const results = [];
  for (let i = 0; i < MAX_LOOKAHEAD_MINUTES && results.length < count; i++) {
    if (fieldsMatch(parsed, wallClockParts(candidate, timezone))) {
      results.push(new Date(candidate));
    }
    candidate = new Date(candidate.getTime() + 60000);
  }
  if (results.length < count) {
    throw new Error(`no run found within the next 2 years for schedule "${schedule}" (timezone ${timezone})`);
  }
  return results;
}
