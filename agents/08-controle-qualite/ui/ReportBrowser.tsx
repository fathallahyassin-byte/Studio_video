"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { buttonClass, Chip } from "@/components/ui";
import type { CheckView, GroupView, LabelView, ReportView } from "./reports";

// Rapports récents à gauche, détail à droite. Le jaune ne sert qu'aux vidéos qui attendent l'humain (V3, NO-GO bloqué).

const textWrap = "[overflow-wrap:anywhere]";
const sectionTitle = "text-base font-[750] text-ink";

export function ReportBrowser({ reports }: { reports: ReportView[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = reports.find((report) => report.videoId === selectedId) ?? reports[0] ?? null;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(240px,320px)_minmax(0,1fr)]">
      <ReportList reports={reports} selectedId={selected?.videoId ?? null} onSelect={setSelectedId} />
      {selected ? <ReportDetail key={selected.videoId} report={selected} /> : null}
    </div>
  );
}

function ReportList({ reports, selectedId, onSelect }: { reports: ReportView[]; selectedId: string | null; onSelect: (id: string) => void }) {
  return (
    <ul aria-label="Rapports récents" className="flex min-w-0 flex-col gap-2">
      {reports.map((report) => {
        const isSelected = report.videoId === selectedId;
        return (
          <li key={report.videoId}>
            <button
              type="button"
              aria-pressed={isSelected}
              onClick={() => onSelect(report.videoId)}
              className={`flex w-full flex-col gap-2 rounded-2xl px-4 py-3 text-left transition-colors duration-150 ${
                isSelected ? "bg-ink text-white" : "bg-white text-text shadow-[inset_0_0_0_1px_var(--color-line)] hover:bg-paper"
              }`}
            >
              <span className={`text-[15px] font-bold ${textWrap}`}>
                {report.label} · {report.title}
              </span>
              <span className="flex flex-wrap gap-1.5">
                <Chip tone={report.decisionTone}>{report.decisionLabel}</Chip>
                <Chip tone={report.status.tone}>{report.status.label}</Chip>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function ReportDetail({ report }: { report: ReportView }) {
  const titleId = useId();
  return (
    <article aria-labelledby={titleId} className="flex min-w-0 flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-bold text-muted">
            {report.label} · mis à jour {report.updatedLabel}
          </p>
          <h3 id={titleId} className={`font-display mt-1 text-[28px] ${textWrap}`}>
            {report.title}
          </h3>
        </div>
        <span className="flex flex-wrap gap-1.5">
          <Chip tone={report.decisionTone}>Décision : {report.decisionLabel}</Chip>
          <Chip tone={report.status.tone}>{report.status.label}</Chip>
        </span>
      </header>

      {report.status.notice ? <AwaitingNotice videoId={report.videoId} notice={report.status.notice} /> : null}

      <section className="flex flex-col gap-2">
        <h4 className={sectionTitle}>Résumé</h4>
        <p className={`whitespace-pre-line text-text ${textWrap}`}>{report.summary}</p>
        <RenderLink href={report.renderHref} />
      </section>

      <Checklist groups={report.groups} missing={report.missingChecks} koCount={report.koCount} />
      <LabelList labels={report.labels} />
      <MentionList mentions={report.mentions} />
    </article>
  );
}

function AwaitingNotice({ videoId, notice }: { videoId: string; notice: string }) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-wait p-4 text-ink">
      <p className="font-bold">{notice}</p>
      <Link href={`/validations?item=${videoId}`} className={`${buttonClass("ink")} self-start`}>
        Ouvrir dans Validations
      </Link>
    </div>
  );
}

function RenderLink({ href }: { href: string | null }) {
  if (!href) return <p className="text-[13px] text-muted">Vidéo rendue : pas encore de fichier enregistré.</p>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={`${buttonClass("ghost")} self-start`}>
      Voir la vidéo rendue
      <span className="sr-only"> (nouvel onglet)</span>
    </a>
  );
}

function Checklist({ groups, missing, koCount }: { groups: GroupView[]; missing: string[]; koCount: number }) {
  return (
    <section className="flex flex-col gap-4">
      <div>
        <h4 className={sectionTitle}>Check-list A à F</h4>
        <p className="text-[13px] text-muted">
          {koCount === 0 ? "Aucun point à corriger." : `${koCount} point(s) à corriger.`}
          {missing.length > 0 ? ` Points absents du rapport : ${missing.join(", ")}.` : ""}
        </p>
      </div>
      {groups.map((group) => (
        <div key={group.group} className="flex flex-col gap-2">
          <h5 className="text-[13px] font-bold uppercase tracking-wide text-muted">{group.title}</h5>
          <ul className="flex flex-col gap-2">
            {group.checks.map((check) => (
              <CheckItem key={check.id} check={check} />
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

function CheckItem({ check }: { check: CheckView }) {
  return (
    <li className="flex min-w-0 flex-col gap-1.5 rounded-[12px] bg-paper px-4 py-3">
      <span className="flex flex-wrap items-center gap-2">
        <Chip tone={check.tone}>{check.statusLabel}</Chip>
        <span className={`font-bold text-ink ${textWrap}`}>
          {check.id} · {check.label}
        </span>
        {check.unverified ? <Chip tone="run">Non vérifié</Chip> : null}
      </span>
      <p className={`text-sm text-text ${textWrap}`}>
        <span className="font-bold">Preuve : </span>
        {check.preuve || "—"}
      </p>
      {check.correction ? (
        <p className={`text-sm text-text ${textWrap}`}>
          <span className="font-bold">Correction : </span>
          {check.correction}
          {check.agent ? <span className="text-muted"> ({check.agent})</span> : null}
        </p>
      ) : null}
    </li>
  );
}

function LabelList({ labels }: { labels: LabelView[] }) {
  return (
    <section className="flex flex-col gap-2">
      <h4 className={sectionTitle}>Étiquettes par plateforme</h4>
      <ul className="grid gap-2 sm:grid-cols-2">
        {labels.map((label) => (
          <li key={label.name} className="flex min-w-0 items-center justify-between gap-3 rounded-[12px] px-4 py-2.5 shadow-[inset_0_0_0_1px_var(--color-line)]">
            <span className={`text-sm text-ink ${textWrap}`}>{label.name}</span>
            <Chip tone={label.on ? "ok" : "run"}>{label.on ? "Activée" : "Non"}</Chip>
          </li>
        ))}
      </ul>
    </section>
  );
}

function MentionList({ mentions }: { mentions: string[] }) {
  return (
    <section className="flex flex-col gap-2">
      <h4 className={sectionTitle}>Mentions à incruster</h4>
      {mentions.length === 0 ? (
        <p className="text-sm text-muted">Aucune mention imposée.</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {mentions.map((mention) => (
            <li key={mention} className={`rounded-full bg-ink px-3 py-1 text-sm font-bold text-white ${textWrap}`}>
              {mention}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
