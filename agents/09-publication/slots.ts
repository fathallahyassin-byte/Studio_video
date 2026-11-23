// Créneaux « AAAA-MM-JJTHH:MM », lus à l'heure locale du serveur (variable TZ, comme le planning du worker).

const SLOT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Un créneau ne peut pas être plus loin que 14 jours. */
export const MAX_HORIZON_MS = 14 * DAY;
/** « Créneaux décalés de quelques heures entre plateformes » : au moins une heure entre deux plateformes. */
export const MIN_GAP_MS = HOUR;

/** Date du créneau, ou null s'il n'existe pas (31 février, 25 h…). */
export function parseSlot(value: string): Date | null {
  const match = SLOT_PATTERN.exec(value);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]));
  return formatSlot(date) === value ? date : null;
}

const pad = (value: number) => String(value).padStart(2, "0");

export function formatSlot(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Lundi 0 h de la semaine de `date` (heure locale). */
export function startOfWeek(date: Date): Date {
  const weekday = date.getDay() === 0 ? 7 : date.getDay();
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - (weekday - 1));
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days, date.getHours(), date.getMinutes());
}

/** Même jour du calendrier local. */
export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

const dayFormat = new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "short" });
const longFormat = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
const timeFormat = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" });

export function formatDay(date: Date): string {
  return dayFormat.format(date);
}

export function formatLongSlot(date: Date): string {
  return longFormat.format(date);
}

export function formatTime(date: Date): string {
  return timeFormat.format(date);
}
