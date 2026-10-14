import type { Language } from "./settings";
import { locales, translate } from "./i18n";

export const defaultTimeZone = "UTC";

export function validTimeZone(value: string) {
  if (!/^[A-Za-z_]+(?:\/[A-Za-z0-9_+\-]+)*$/.test(value)) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

export function zoneOffset(timeZone: string, timestamp = Date.now() / 1000) {
  const name = new Intl.DateTimeFormat("en", { timeZone, timeZoneName: "shortOffset" })
    .formatToParts(new Date(timestamp * 1000)).find((part) => part.type === "timeZoneName")!.value;
  return name.replace("GMT", "UTC").replace("−", "-").replace(/^UTC[+-]0(?::00)?$/, "UTC");
}

export function formatDate(
  timestamp: number | null | undefined,
  language: Language,
  timeZone: string = defaultTimeZone,
  options: Intl.DateTimeFormatOptions = { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }
) {
  if (timestamp == null) return translate(language, "Sin datos");
  return `${new Intl.DateTimeFormat(locales[language], { ...options, timeZone }).format(timestamp * 1000)} (${zoneOffset(timeZone, timestamp)})`;
}

export function localDateTime(timestamp: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
  }).formatToParts(timestamp * 1000);
  const part = (name: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === name)!.value;
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}:${part("second")}`;
}

export function parseDateTime(value: string, timeZone: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value)) return null;
  const normalized = value.length === 16 ? `${value}:00` : value;
  const wall = Date.parse(`${normalized}Z`) / 1000;
  if (!Number.isFinite(wall)) return null;
  const offsets = [-86400, 0, 86400].map((delta) => {
    const probe = wall + delta;
    return Date.parse(`${localDateTime(probe, timeZone)}Z`) / 1000 - probe;
  });
  const matches = offsets.map((offset) => wall - offset)
    .filter((candidate) => localDateTime(candidate, timeZone) === normalized);
  return matches.length ? Math.min(...matches) : null;
}

export function utcDay(day: string, language: Language, short = false) {
  return formatDate(Date.parse(`${day}T00:00:00Z`) / 1000, language, "UTC", {
    day: "numeric", month: "short", ...(short ? {} : { year: "numeric" })
  });
}
