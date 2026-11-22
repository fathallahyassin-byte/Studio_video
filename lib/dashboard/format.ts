const money = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 2 });
const integer = new Intl.NumberFormat("fr-FR");
const percent = new Intl.NumberFormat("fr-FR", { style: "percent", maximumFractionDigits: 0 });
const dateTime = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** Montant dans la monnaie des budgets (euros, comme la maquette). */
export function formatMoney(value: number): string {
  return money.format(value);
}

export function formatInteger(value: number): string {
  return integer.format(value);
}

/** 0,42 → « 42 % » */
export function formatPercent(ratio: number): string {
  return percent.format(ratio);
}

export function formatDateTime(date: Date): string {
  return dateTime.format(date);
}

export function formatVideoNumber(number: number): string {
  return `V-${String(number).padStart(3, "0")}`;
}

/** « 0–3 s », « 10–40 s » */
export function formatTimeRange(startS: number, endS: number): string {
  const round = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(1).replace(".", ","));
  return `${round(startS)}–${round(endS)} s`;
}

export function formatRelative(date: Date, now: Date): string {
  const minutes = Math.round((now.getTime() - date.getTime()) / 60_000);
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.round(hours / 24);
  return days === 1 ? "hier" : `il y a ${days} jours`;
}

export function startOfMonth(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), 1);
}
