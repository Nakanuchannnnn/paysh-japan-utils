// Holiday / business-day engine for JP, US, DE, FR, GB.
// Fully rules-based and deterministic; no external data.
// Supported year range: 2020-2030 (JP includes the 2020/2021 Olympic
// special-case rescheduling).

const MIN_YEAR = 2020;
const MAX_YEAR = 2030;

function d(y, m, day) {
  return new Date(Date.UTC(y, m - 1, day));
}
function fmt(date) {
  return date.toISOString().slice(0, 10);
}
function parseDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || "");
  if (!m) return null;
  const dt = d(Number(m[1]), Number(m[2]), Number(m[3]));
  if (fmt(dt) !== s) return null;
  return dt;
}
function addDays(date, n) {
  const x = new Date(date.getTime());
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}
function nthWeekday(year, month, weekday, n) {
  // weekday: 0=Sun..6=Sat; n>=1 nth, n=-1 last
  if (n > 0) {
    const first = d(year, month, 1);
    const delta = (weekday - first.getUTCDay() + 7) % 7;
    return d(year, month, 1 + delta + (n - 1) * 7);
  }
  const last = d(year, month + 1, 0);
  const delta = (last.getUTCDay() - weekday + 7) % 7;
  return d(year, month, last.getUTCDate() - delta);
}
// Gregorian Easter Sunday (Computus, Meeus/Jones/Butcher).
function easter(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const dd = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - dd - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const mm = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * mm + 114) / 31);
  const day = ((h + l - 7 * mm + 114) % 31) + 1;
  return d(year, month, day);
}

// ---------------- Japan ----------------
function jpBaseHolidays(year) {
  const list = []; // {date: Date, name, name_en}
  const add = (date, name, name_en) => list.push({ date, name, name_en });
  add(d(year, 1, 1), "元日", "New Year's Day");
  add(nthWeekday(year, 1, 1, 2), "成人の日", "Coming of Age Day");
  add(d(year, 2, 11), "建国記念の日", "National Foundation Day");
  add(d(year, 2, 23), "天皇誕生日", "The Emperor's Birthday");
  // Vernal equinox (approximation valid 1980-2099)
  const springEq = Math.floor(20.8431 + 0.242194 * (year - 1980)) - Math.floor((year - 1980) / 4);
  add(d(year, 3, springEq), "春分の日", "Vernal Equinox Day");
  add(d(year, 4, 29), "昭和の日", "Showa Day");
  add(d(year, 5, 3), "憲法記念日", "Constitution Memorial Day");
  add(d(year, 5, 4), "みどりの日", "Greenery Day");
  add(d(year, 5, 5), "こどもの日", "Children's Day");
  // Marine Day / Sports Day / Mountain Day with Olympic exceptions
  if (year === 2020) {
    add(d(2020, 7, 23), "海の日", "Marine Day");
    add(d(2020, 7, 24), "スポーツの日", "Sports Day");
    add(d(2020, 8, 10), "山の日", "Mountain Day");
  } else if (year === 2021) {
    add(d(2021, 7, 22), "海の日", "Marine Day");
    add(d(2021, 7, 23), "スポーツの日", "Sports Day");
    add(d(2021, 8, 8), "山の日", "Mountain Day");
  } else {
    add(nthWeekday(year, 7, 1, 3), "海の日", "Marine Day");
    add(d(year, 8, 11), "山の日", "Mountain Day");
    add(nthWeekday(year, 10, 1, 2), "スポーツの日", "Sports Day");
  }
  add(nthWeekday(year, 9, 1, 3), "敬老の日", "Respect for the Aged Day");
  const autumnEq = Math.floor(23.2488 + 0.242194 * (year - 1980)) - Math.floor((year - 1980) / 4);
  add(d(year, 9, autumnEq), "秋分の日", "Autumnal Equinox Day");
  add(d(year, 11, 3), "文化の日", "Culture Day");
  add(d(year, 11, 23), "勤労感謝の日", "Labor Thanksgiving Day");
  return list;
}
function jpHolidays(year) {
  const map = new Map(); // 'YYYY-MM-DD' -> {name, name_en, kind}
  for (const h of jpBaseHolidays(year)) {
    map.set(fmt(h.date), { name: h.name, name_en: h.name_en, kind: "national" });
  }
  // Substitute holidays (振替休日): a national holiday on Sunday moves to the
  // next day that is not itself a holiday.
  for (const h of jpBaseHolidays(year)) {
    if (h.date.getUTCDay() === 0) {
      let sub = addDays(h.date, 1);
      while (map.has(fmt(sub))) sub = addDays(sub, 1);
      map.set(fmt(sub), { name: "振替休日", name_en: "Substitute Holiday", kind: "substitute" });
    }
  }
  // Citizens' holidays (国民の休日): a weekday sandwiched between two
  // national holidays becomes a holiday.
  const base = new Set(jpBaseHolidays(year).map((h) => fmt(h.date)));
  let cur = d(year, 1, 1);
  const end = d(year, 12, 31);
  while (cur <= end) {
    const key = fmt(cur);
    const dow = cur.getUTCDay();
    if (!map.has(key) && dow >= 1 && dow <= 5) {
      if (base.has(fmt(addDays(cur, -1))) && base.has(fmt(addDays(cur, 1)))) {
        map.set(key, { name: "国民の休日", name_en: "Citizens' Holiday", kind: "citizens" });
      }
    }
    cur = addDays(cur, 1);
  }
  return map;
}

// ---------------- United States (federal) ----------------
function usHolidays(year) {
  const map = new Map();
  const add = (date, name) => map.set(fmt(date), { name, name_en: name, kind: "federal" });
  const fixed = (m, day, name) => {
    const date = d(year, m, day);
    add(date, name);
    const dow = date.getUTCDay();
    if (dow === 6) add(addDays(date, -1), `${name} (Observed)`);
    if (dow === 0) add(addDays(date, 1), `${name} (Observed)`);
  };
  fixed(1, 1, "New Year's Day");
  add(nthWeekday(year, 1, 1, 3), "Martin Luther King Jr. Day");
  add(nthWeekday(year, 2, 1, 3), "Washington's Birthday");
  add(nthWeekday(year, 5, 1, -1), "Memorial Day");
  fixed(6, 19, "Juneteenth National Independence Day");
  fixed(7, 4, "Independence Day");
  add(nthWeekday(year, 9, 1, 1), "Labor Day");
  add(nthWeekday(year, 10, 1, 2), "Columbus Day");
  fixed(11, 11, "Veterans Day");
  add(nthWeekday(year, 11, 4, 4), "Thanksgiving Day");
  fixed(12, 25, "Christmas Day");
  return map;
}

// ---------------- Germany (federal) ----------------
function deHolidays(year) {
  const map = new Map();
  const add = (date, name, en) => map.set(fmt(date), { name, name_en: en, kind: "national" });
  const e = easter(year);
  add(d(year, 1, 1), "Neujahr", "New Year's Day");
  add(addDays(e, -2), "Karfreitag", "Good Friday");
  add(addDays(e, 1), "Ostermontag", "Easter Monday");
  add(d(year, 5, 1), "Tag der Arbeit", "Labour Day");
  add(addDays(e, 39), "Christi Himmelfahrt", "Ascension Day");
  add(addDays(e, 50), "Pfingstmontag", "Whit Monday");
  add(d(year, 10, 3), "Tag der Deutschen Einheit", "German Unity Day");
  add(d(year, 12, 25), "1. Weihnachtstag", "Christmas Day");
  add(d(year, 12, 26), "2. Weihnachtstag", "Boxing Day");
  return map;
}

// ---------------- France ----------------
function frHolidays(year) {
  const map = new Map();
  const add = (date, name, en) => map.set(fmt(date), { name, name_en: en, kind: "national" });
  const e = easter(year);
  add(d(year, 1, 1), "Jour de l'An", "New Year's Day");
  add(addDays(e, 1), "Lundi de Pâques", "Easter Monday");
  add(d(year, 5, 1), "Fête du Travail", "Labour Day");
  add(d(year, 5, 8), "Victoire 1945", "Victory Day 1945");
  add(addDays(e, 39), "Ascension", "Ascension Day");
  add(addDays(e, 50), "Lundi de Pentecôte", "Whit Monday");
  add(d(year, 7, 14), "Fête nationale", "National Day");
  add(d(year, 8, 15), "Assomption", "Assumption Day");
  add(d(year, 11, 1), "Toussaint", "All Saints' Day");
  add(d(year, 11, 11), "Armistice", "Armistice Day");
  add(d(year, 12, 25), "Noël", "Christmas Day");
  return map;
}

// ---------------- United Kingdom (England & Wales) ----------------
function gbHolidays(year) {
  const map = new Map();
  const add = (date, name) => map.set(fmt(date), { name, name_en: name, kind: "bank" });
  const fixedWithSubstitute = (m, day, name) => {
    const date = d(year, m, day);
    const dow = date.getUTCDay();
    if (dow === 6) add(addDays(date, 2), `${name} (substitute day)`);
    else if (dow === 0) add(addDays(date, 1), `${name} (substitute day)`);
    else add(date, name);
  };
  const e = easter(year);
  fixedWithSubstitute(1, 1, "New Year's Day");
  add(addDays(e, -2), "Good Friday");
  add(nthWeekday(year, 5, 1, 1), "Early May bank holiday");
  add(nthWeekday(year, 5, 1, -1), "Spring bank holiday");
  add(nthWeekday(year, 8, 1, -1), "Summer bank holiday");
  // Christmas / Boxing Day substitutes must not collide with each other.
  const xmas = d(year, 12, 25);
  fixedWithSubstitute(12, 25, "Christmas Day");
  const boxing = d(year, 12, 26);
  if (boxing.getUTCDay() === 6) add(d(year, 12, 28), "Boxing Day (substitute day)");
  else if (boxing.getUTCDay() === 0) add(d(year, 12, 27), "Boxing Day (substitute day)");
  else if (xmas.getUTCDay() === 6 && boxing.getUTCDay() === 0) add(d(year, 12, 27), "Boxing Day (substitute day)");
  else add(boxing, "Boxing Day");
  return map;
}

const ENGINES = { JP: jpHolidays, US: usHolidays, DE: deHolidays, FR: frHolidays, GB: gbHolidays };
const cache = new Map();
export function holidaysOf(country, year) {
  const key = `${country}:${year}`;
  if (!cache.has(key)) cache.set(key, ENGINES[country](year));
  return cache.get(key);
}
export function isBusinessDay(country, date) {
  const dow = date.getUTCDay();
  if (dow === 0 || dow === 6) return { business: false, holiday: null };
  const h = holidaysOf(country, date.getUTCFullYear()).get(fmt(date));
  return { business: !h, holiday: h || null };
}

function badRequest(message) {
  return { status: 400, json: { error: message } };
}
function countryParam(q) {
  const c = (q.get("country") || "JP").toUpperCase();
  return ENGINES[c] ? c : null;
}
function yearParam(q) {
  const y = Number(q.get("year"));
  if (!Number.isInteger(y) || y < MIN_YEAR || y > MAX_YEAR) return null;
  return y;
}

export const routes = [
  {
    id: "calendar.holidays",
    method: "GET",
    path: "/v1/holidays",
    priceAtomic: "10000",
    priceUsd: 0.01,
    summary: "List national/public holidays for a year (JP, US, DE, FR, GB)",
    query: {
      year: { type: "integer", required: true, description: "Year, 2020-2030", example: 2026 },
      country: { type: "string", required: false, description: "Country code: JP (default), US, DE, FR, GB", example: "JP" },
    },
    handler({ query }) {
      const year = yearParam(query);
      if (year === null) return badRequest(`year must be an integer in ${MIN_YEAR}-${MAX_YEAR}`);
      const country = countryParam(query);
      if (!country) return badRequest("country must be one of JP, US, DE, FR, GB");
      const map = holidaysOf(country, year);
      const holidays = [...map.entries()]
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([date, h]) => ({ date, name: h.name, name_en: h.name_en, kind: h.kind }));
      return { json: { country, year, count: holidays.length, holidays } };
    },
  },
  {
    id: "calendar.businessDay",
    method: "GET",
    path: "/v1/business-day",
    priceAtomic: "10000",
    priceUsd: 0.01,
    summary: "Check whether a date is a business day in a country",
    query: {
      date: { type: "string", required: true, description: "Date, YYYY-MM-DD", example: "2026-11-24" },
      country: { type: "string", required: false, description: "Country code: JP (default), US, DE, FR, GB", example: "JP" },
    },
    handler({ query }) {
      const country = countryParam(query);
      if (!country) return badRequest("country must be one of JP, US, DE, FR, GB");
      const date = parseDate(query.get("date"));
      if (!date) return badRequest("date must be YYYY-MM-DD");
      if (date.getUTCFullYear() < MIN_YEAR || date.getUTCFullYear() > MAX_YEAR) {
        return badRequest(`date year must be in ${MIN_YEAR}-${MAX_YEAR}`);
      }
      const { business, holiday } = isBusinessDay(country, date);
      const dow = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][date.getUTCDay()];
      return {
        json: {
          country,
          date: fmt(date),
          day_of_week: dow,
          is_business_day: business,
          is_weekend: date.getUTCDay() === 0 || date.getUTCDay() === 6,
          holiday: holiday ? { name: holiday.name, name_en: holiday.name_en } : null,
        },
      };
    },
  },
  {
    id: "calendar.addBusinessDays",
    method: "GET",
    path: "/v1/business-days/add",
    priceAtomic: "10000",
    priceUsd: 0.01,
    summary: "Add (or subtract) N business days to a date",
    query: {
      date: { type: "string", required: true, description: "Start date, YYYY-MM-DD", example: "2026-11-20" },
      days: { type: "integer", required: true, description: "Business days to add (negative to subtract), -366..366", example: 3 },
      country: { type: "string", required: false, description: "Country code: JP (default), US, DE, FR, GB", example: "JP" },
    },
    handler({ query }) {
      const country = countryParam(query);
      if (!country) return badRequest("country must be one of JP, US, DE, FR, GB");
      const start = parseDate(query.get("date"));
      if (!start) return badRequest("date must be YYYY-MM-DD");
      const days = Number(query.get("days"));
      if (!Number.isInteger(days) || Math.abs(days) > 366) return badRequest("days must be an integer in -366..366");
      let cur = start;
      let remaining = Math.abs(days);
      const step = days >= 0 ? 1 : -1;
      while (remaining > 0) {
        cur = addDays(cur, step);
        if (cur.getUTCFullYear() < MIN_YEAR || cur.getUTCFullYear() > MAX_YEAR) {
          return badRequest(`result out of supported range ${MIN_YEAR}-${MAX_YEAR}`);
        }
        if (isBusinessDay(country, cur).business) remaining -= 1;
      }
      return { json: { country, start: fmt(start), days, result: fmt(cur) } };
    },
  },
];
