// Japanese era (wareki) <-> Gregorian (seireki) conversion.
const ERAS = [
  { name: "明治", name_en: "Meiji", start: "1868-10-23", startYear: 1868 },
  { name: "大正", name_en: "Taisho", start: "1912-07-30", startYear: 1912 },
  { name: "昭和", name_en: "Showa", start: "1926-12-25", startYear: 1926 },
  { name: "平成", name_en: "Heisei", start: "1989-01-08", startYear: 1989 },
  { name: "令和", name_en: "Reiwa", start: "2019-05-01", startYear: 2019 },
];

function parseDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || "");
  if (!m) return null;
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (dt.toISOString().slice(0, 10) !== s) return null;
  return dt;
}
function badRequest(message) {
  return { status: 400, json: { error: message } };
}

export function toWareki(dateStr) {
  const date = parseDate(dateStr);
  if (!date) return null;
  for (let i = ERAS.length - 1; i >= 0; i--) {
    const era = ERAS[i];
    if (dateStr >= era.start) {
      const year = date.getUTCFullYear() - era.startYear + 1;
      return {
        era: era.name,
        era_en: era.name_en,
        year,
        label: `${era.name}${year === 1 ? "元" : year}年`,
        month: date.getUTCMonth() + 1,
        day: date.getUTCDate(),
      };
    }
  }
  return null; // before Meiji
}

export function toSeireki(eraName, eraYear, month, day) {
  const idx = ERAS.findIndex((e) => e.name === eraName || e.name_en.toLowerCase() === String(eraName).toLowerCase());
  if (idx < 0) return { error: "era must be one of 明治, 大正, 昭和, 平成, 令和 (or Meiji/Taisho/Showa/Heisei/Reiwa)" };
  const era = ERAS[idx];
  if (!Number.isInteger(eraYear) || eraYear < 1) return { error: "era year must be a positive integer (use 1 for 元年)" };
  const gy = era.startYear + eraYear - 1;
  const dateStr = `${gy}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const date = parseDate(dateStr);
  if (!date) return { error: "invalid month/day for that date" };
  const next = ERAS[idx + 1];
  if (dateStr < era.start || (next && dateStr >= next.start)) {
    return { error: `${era.name}${eraYear}年${month}月${day}日 does not exist (outside the era's actual span)` };
  }
  return { date: dateStr, era: era.name, era_en: era.name_en, year: eraYear };
}

export const routes = [
  {
    id: "wareki.toWareki",
    method: "GET",
    path: "/v1/wareki",
    priceAtomic: "10000",
    priceUsd: 0.01,
    summary: "Convert a Gregorian date to Japanese era (wareki)",
    query: {
      date: { type: "string", required: true, description: "Gregorian date, YYYY-MM-DD (1868-10-23 or later)", example: "2026-11-22" },
    },
    handler({ query }) {
      const date = query.get("date");
      if (!parseDate(date)) return badRequest("date must be YYYY-MM-DD");
      const w = toWareki(date);
      if (!w) return badRequest("date is before the Meiji era (1868-10-23)");
      return { json: { date, ...w, formatted: `${w.label}${w.month}月${w.day}日` } };
    },
  },
  {
    id: "wareki.toSeireki",
    method: "GET",
    path: "/v1/seireki",
    priceAtomic: "10000",
    priceUsd: 0.01,
    summary: "Convert a Japanese era date to Gregorian (seireki)",
    query: {
      era: { type: "string", required: true, description: "Era name: 令和/平成/昭和/大正/明治 or Reiwa/Heisei/Showa/Taisho/Meiji", example: "令和" },
      year: { type: "integer", required: true, description: "Year within the era (1 = first year)", example: 8 },
      month: { type: "integer", required: true, description: "Month 1-12", example: 11 },
      day: { type: "integer", required: true, description: "Day of month", example: 22 },
    },
    handler({ query }) {
      const r = toSeireki(
        query.get("era"),
        Number(query.get("year")),
        Number(query.get("month")),
        Number(query.get("day"))
      );
      if (r.error) return badRequest(r.error);
      return { json: r };
    },
  },
];
