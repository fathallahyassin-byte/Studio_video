import { Chip } from "@/components/ui";
import { CRITERION_COLUMNS, type CandidateView, type NoteView } from "./view";

// Niches candidates triées par score pondéré recalculé. Grand écran : tableau, justification au survol
// et au focus clavier. Petit écran : une carte par niche, sans défilement horizontal.

const textWrap = "[overflow-wrap:anywhere]";
const cell = "px-2 py-3 text-left align-top";

function Badges({ candidate }: { candidate: CandidateView }) {
  if (!candidate.inTop3) return null;
  return <Chip tone={candidate.recommended ? "ok" : "run"}>{candidate.recommended ? "Recommandée" : "Top 3"}</Chip>;
}

/** Note cliquable au clavier : sa justification s'affiche au survol et au focus, et sert de description. */
function NoteButton({ note, tipId, alignRight }: { note: NoteView; tipId: string; alignRight: boolean }) {
  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        aria-label={`${note.label} : ${note.note} sur 5`}
        aria-describedby={tipId}
        className="min-h-9 min-w-9 rounded-lg bg-paper font-bold text-ink hover:bg-ink hover:text-white"
      >
        {note.note}
      </button>
      <span
        id={tipId}
        role="tooltip"
        className={`invisible absolute top-full z-20 mt-1.5 w-64 rounded-xl bg-ink p-3 text-left text-[13px] leading-snug font-normal text-white opacity-0 shadow-lg group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100 motion-safe:transition-opacity ${alignRight ? "right-0" : "left-0"} ${textWrap}`}
      >
        <span className="font-bold">{note.label}</span> — {note.why}
      </span>
    </span>
  );
}

function NicheCell({ candidate }: { candidate: CandidateView }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="flex flex-wrap items-center gap-2">
        <span className={`font-bold text-ink ${textWrap}`}>{candidate.niche}</span>
        <Badges candidate={candidate} />
      </span>
      <span className={`text-[13px] text-muted ${textWrap}`}>
        {candidate.audience} · {candidate.angle}
      </span>
    </div>
  );
}

function CandidateRows({ candidates }: { candidates: CandidateView[] }) {
  return (
    <tbody>
      {candidates.map((candidate) => (
        <tr key={candidate.rank} className="border-t border-line">
          <td className={`${cell} font-bold text-muted`}>{candidate.rank}</td>
          <td className={cell}>
            <NicheCell candidate={candidate} />
          </td>
          {candidate.notes.map((note, index) => (
            <td key={note.key} className={`${cell} text-center`}>
              <NoteButton note={note} tipId={`note-${candidate.rank}-${note.key}`} alignRight={index >= 3} />
            </td>
          ))}
          <td className={`${cell} text-right font-display text-[20px] tabular-nums`}>{candidate.scoreLabel}</td>
        </tr>
      ))}
    </tbody>
  );
}

function CandidateGrid({ candidates, maxScoreLabel }: { candidates: CandidateView[]; maxScoreLabel: string }) {
  return (
    <table className="hidden w-full border-collapse text-sm lg:table">
      <caption className="sr-only">Niches candidates, de la meilleure à la moins bonne, score pondéré sur {maxScoreLabel}</caption>
      <thead className="text-muted">
        <tr>
          <th scope="col" className={cell}>
            <span className="sr-only">Rang</span>#
          </th>
          <th scope="col" className={cell}>
            Niche
          </th>
          {CRITERION_COLUMNS.map((column) => (
            <th key={column.key} scope="col" className={`${cell} text-center whitespace-nowrap`}>
              <abbr title={column.label} className="no-underline">
                {column.short}
              </abbr>
              <span className="block text-[11px] font-normal">{column.weightLabel}</span>
            </th>
          ))}
          <th scope="col" className={`${cell} text-right`}>
            Score
            <span className="block text-[11px] font-normal">/ {maxScoreLabel}</span>
          </th>
        </tr>
      </thead>
      <CandidateRows candidates={candidates} />
    </table>
  );
}

function CandidateCards({ candidates }: { candidates: CandidateView[] }) {
  return (
    <ol className="flex flex-col gap-3 lg:hidden">
      {candidates.map((candidate) => (
        <li key={candidate.rank} className="flex flex-col gap-3 rounded-2xl bg-paper p-4">
          <div className="flex items-start justify-between gap-3">
            <NicheCell candidate={candidate} />
            <span className="font-display text-[22px] tabular-nums" aria-label={`Score pondéré ${candidate.scoreLabel}`}>
              {candidate.scoreLabel}
            </span>
          </div>
          <details>
            <summary className="cursor-pointer text-[13px] font-bold text-ink">Notes et justifications</summary>
            <dl className="mt-2 flex flex-col gap-2 text-[13px]">
              {candidate.notes.map((note) => (
                <div key={note.key}>
                  <dt className="font-bold text-ink">
                    {note.label} : {note.note}/5
                  </dt>
                  <dd className={`text-text ${textWrap}`}>{note.why}</dd>
                </div>
              ))}
            </dl>
          </details>
        </li>
      ))}
    </ol>
  );
}

export function CandidateTable({ candidates, maxScoreLabel }: { candidates: CandidateView[]; maxScoreLabel: string }) {
  return (
    <>
      <CandidateGrid candidates={candidates} maxScoreLabel={maxScoreLabel} />
      <CandidateCards candidates={candidates} />
    </>
  );
}
