// Date/time utilities: IANA timezone conversion and Unix timestamp conversion.
// Uses Node's built-in Intl (full ICU tz database). Deterministic for a given
// input instant; DST rules follow the system tz database.

function tzOffsetMs(tz, utcDate) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(utcDate);
  const p = {};
  for (const part of parts) p[part.type] = part.value;
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour) % 24, Number(p.minute), Number(p.second));
  return asUtc - Math.floor(utcDate.getTime() / 1000) * 1000;
}
function wallTimeToUtc(tz, y, mo, d, h, mi, s) {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  let offset = tzOffsetMs(tz, new Date(guess));
  let utc = guess - offset;
  offset = tzOffsetMs(tz, new Date(utc));
  utc = guess - offset;
  return new Date(utc);
}
function formatInTz(tz, date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(date);
  const p = {};
  for (const part of parts) p[part.type] = part.value;
  const offMs = tzOffsetMs(tz, date);
  const sign = offMs < 0 ? "-" : "+";
  const abs = Math.abs(offMs);
  const oh = String(Math.floor(abs / 3600000)).padStart(2, "0");
  const om = String(Math.floor((abs % 3600000) / 60000)).padStart(2, "0");
  return {
    local: `${p.year}-${p.month}-${p.day}T${String(p.hour % 24).padStart(2, "0")}:${p.minute}:${p.second}${sign}${oh}:${om}`,
    offset: `${sign}${oh}:${om}`,
  };
}
function validTz(tz) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
function badRequest(message) {
  return { status: 400, json: { error: message } };
}

export const routes = [
  {
    id: "time.convert",
    method: "POST",
    path: "/v1/time/convert",
    priceAtomic: "10000",
    priceUsd: 0.01,
    summary: "Convert a wall-clock time between IANA timezones",
    body: {
      required: ["datetime", "from_tz", "to_tz"],
      properties: {
        datetime: { type: "string", description: "Wall-clock time in from_tz: YYYY-MM-DD HH:mm:ss (or with T separator)", example: "2026-11-22 22:00:00" },
        from_tz: { type: "string", description: "Source IANA timezone", example: "Asia/Tokyo" },
        to_tz: { type: "string", description: "Target IANA timezone", example: "America/New_York" },
      },
    },
    handler({ body }) {
      const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(body?.datetime || ""));
      if (!m) return badRequest("datetime must be \"YYYY-MM-DD HH:mm:ss\"");
      if (!validTz(body.from_tz) || !validTz(body.to_tz)) return badRequest("from_tz / to_tz must be valid IANA timezone names");
      const utc = wallTimeToUtc(body.from_tz, Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] || 0));
      const from = formatInTz(body.from_tz, utc);
      const to = formatInTz(body.to_tz, utc);
      return {
        json: {
          from: { tz: body.from_tz, local: from.local, utc_offset: from.offset },
          to: { tz: body.to_tz, local: to.local, utc_offset: to.offset },
          utc: utc.toISOString(),
          unix: Math.floor(utc.getTime() / 1000),
        },
      };
    },
  },
  {
    id: "time.unix",
    method: "POST",
    path: "/v1/time/unix",
    priceAtomic: "10000",
    priceUsd: 0.01,
    summary: "Convert between Unix timestamps and ISO 8601 datetimes",
    body: {
      required: ["input"],
      properties: {
        input: { type: ["string", "number"], description: "Unix seconds/milliseconds (number or numeric string) or an ISO 8601 datetime string", example: 1795350000 },
      },
    },
    handler({ body }) {
      const input = body?.input;
      if (typeof input === "number" || (typeof input === "string" && /^-?\d+(\.\d+)?$/.test(input.trim()))) {
        const v = Number(input);
        const ms = Math.abs(v) >= 1e12 ? Math.round(v) : Math.round(v * 1000);
        const date = new Date(ms);
        if (Number.isNaN(date.getTime())) return badRequest("timestamp out of range");
        return {
          json: {
            unix_seconds: Math.floor(ms / 1000),
            unix_millis: ms,
            iso8601: date.toISOString(),
            jst: formatInTz("Asia/Tokyo", date).local,
          },
        };
      }
      if (typeof input === "string") {
        const date = new Date(input);
        if (Number.isNaN(date.getTime())) return badRequest("input is neither a Unix timestamp nor a parseable ISO 8601 datetime");
        return {
          json: {
            unix_seconds: Math.floor(date.getTime() / 1000),
            unix_millis: date.getTime(),
            iso8601: date.toISOString(),
          },
        };
      }
      return badRequest("input must be a number or string");
    },
  },
];
