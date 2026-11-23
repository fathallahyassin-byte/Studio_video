import Link from "next/link";
import type { CalendarEntry, WeekView } from "./overview";

// Calendrier d'une semaine : une ligne par plateforme, une colonne par jour (grand écran) ;
// sur mobile, la même information jour par jour, sans défilement horizontal.

function EntryLink({ entry }: { entry: CalendarEntry }) {
  return (
    <Link
      href={`?video=${entry.videoId}`}
      scroll={false}
      className={`block rounded-xl px-2.5 py-2 text-[13px] leading-snug break-words no-underline ${
        entry.awaitingAction ? "bg-wait text-ink" : "bg-paper text-text hover:bg-column"
      }`}
    >
      <span className="font-bold">{entry.time}</span> · {entry.label}
      <span className="line-clamp-2 block text-muted">{entry.awaitingAction ? entry.status.label : entry.title}</span>
    </Link>
  );
}

export function WeekCalendar({ week }: { week: WeekView }) {
  return (
    <section aria-label={`Calendrier : ${week.title}`} className="flex flex-col gap-3">
      <h3 className="text-[15px] font-[750] text-ink">
        {week.title} <span className="font-normal text-muted">· {week.count === 0 ? "rien de programmé" : `${week.count} publication(s)`}</span>
      </h3>
      <DesktopGrid week={week} />
      <MobileList week={week} />
    </section>
  );
}

function DesktopGrid({ week }: { week: WeekView }) {
  return (
    <div className="hidden gap-1.5 xl:grid xl:grid-cols-[8.5rem_repeat(7,minmax(0,1fr))]">
      <span />
      {week.days.map((day) => (
        <span key={day.key} className={`rounded-lg px-2 py-1 text-[13px] font-bold ${day.isToday ? "bg-ink text-white" : "text-muted"}`}>
          {day.label}
        </span>
      ))}
      {week.rows.map((row) => (
        <div key={row.platform} className="contents">
          <span className="self-start px-1 py-2 text-[13px] font-bold text-ink">{row.label}</span>
          {row.cells.map((entries, index) => (
            <div key={`${row.platform}-${week.days[index]?.key ?? index}`} className="flex min-h-14 flex-col gap-1 rounded-xl p-1 shadow-[inset_0_0_0_1px_var(--color-line)]">
              {entries.map((entry) => (
                <EntryLink key={entry.key} entry={entry} />
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function MobileList({ week }: { week: WeekView }) {
  const days = week.days
    .map((day, index) => ({ day, rows: week.rows.map((row) => ({ label: row.label, platform: row.platform, entries: row.cells[index] ?? [] })).filter((row) => row.entries.length > 0) }))
    .filter((entry) => entry.rows.length > 0);
  if (days.length === 0) return <p className="text-sm text-muted xl:hidden">Aucune publication cette semaine-là.</p>;
  return (
    <ol className="flex flex-col gap-3 xl:hidden">
      {days.map(({ day, rows }) => (
        <li key={day.key} className="flex flex-col gap-1.5">
          <span className="text-[13px] font-bold text-ink">
            {day.label}
            {day.isToday ? " (aujourd'hui)" : ""}
          </span>
          {rows.map((row) => (
            <div key={row.platform} className="flex flex-col gap-1">
              <span className="text-[12px] font-bold text-muted">{row.label}</span>
              {row.entries.map((entry) => (
                <EntryLink key={entry.key} entry={entry} />
              ))}
            </div>
          ))}
        </li>
      ))}
    </ol>
  );
}
