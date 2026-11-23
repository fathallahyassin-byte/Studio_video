"use client";

import { buttonClass, FormMessage } from "@/components/ui";
import { useKeptForm } from "@/components/useKeptForm";
import { applyToBibleAction, closeExperimentAction, launchAnalysisAction, launchExperimentAction, type AnalystFormState } from "./actions";

// Formulaires du panneau de l'analyste (le résultat de chaque commande s'affiche sous son bouton).

const textWrap = "[overflow-wrap:anywhere]";

export function LaunchAnalysisForm() {
  const { state, pending, onSubmit } = useKeptForm<AnalystFormState>(launchAnalysisAction, null);
  return (
    <form onSubmit={onSubmit} className="flex flex-col items-start gap-2">
      <button type="submit" className={buttonClass("ink")} disabled={pending}>
        {pending ? "Envoi…" : "Lancer l'analyse"}
      </button>
      <FormMessage state={state} />
    </form>
  );
}

export function ExperimentForm({ experimentId, action }: { experimentId: string; action: "launch" | "close" }) {
  const { state, pending, onSubmit } = useKeptForm<AnalystFormState>(action === "launch" ? launchExperimentAction : closeExperimentAction, null);
  return (
    <form onSubmit={onSubmit} className="flex flex-col items-start gap-2">
      <input type="hidden" name="experimentId" value={experimentId} />
      <button type="submit" className={`${buttonClass(action === "launch" ? "ink" : "ghost")} min-h-10 px-4 text-sm`} disabled={pending}>
        {pending ? "Envoi…" : action === "launch" ? "Lancer" : "Clore l'expérience"}
      </button>
      <FormMessage state={state} />
    </form>
  );
}

type ApplyProps = { reportId: string; lines: string[]; appliedVersion: number | null; hasActiveBible: boolean };

/** Apprentissages à cocher, puis « Appliquer à la bible » (nouvelle version, jamais de modification). */
export function ApplyToBibleForm({ reportId, lines, appliedVersion, hasActiveBible }: ApplyProps) {
  const { state, pending, onSubmit } = useKeptForm<AnalystFormState>(applyToBibleAction, null);
  const applied = appliedVersion !== null;
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <input type="hidden" name="reportId" value={reportId} />
      <fieldset className="flex min-w-0 flex-col gap-2" disabled={applied}>
        <legend className="mb-1 text-[13px] font-bold text-ink">Apprentissages proposés pour la bible</legend>
        {lines.map((line, index) => (
          <div key={line} className="flex items-start gap-3 rounded-xl bg-paper px-3 py-2.5">
            <input id={`bible-line-${index}`} type="checkbox" name="lines" value={index} defaultChecked className="mt-1 size-4 shrink-0 accent-black" />
            <label htmlFor={`bible-line-${index}`} className={`text-[15px] ${textWrap}`}>
              {line}
            </label>
          </div>
        ))}
      </fieldset>
      {applied ? (
        <p className="text-[13px] text-muted">Appliqués à la bible v{appliedVersion} (version créée par l&apos;analyste, visible dans l&apos;historique de l&apos;écran Bible).</p>
      ) : (
        <div className="flex flex-col items-start gap-2">
          <button type="submit" className={buttonClass("hi")} disabled={pending || !hasActiveBible}>
            {pending ? "Création de la version…" : "Appliquer à la bible"}
          </button>
          <p className="text-[13px] text-muted">
            {hasActiveBible
              ? "Crée une nouvelle version de la bible avec ces lignes dans « apprentissages » et l'adopte ; la version actuelle reste dans l'historique."
              : "Aucune bible active : crée-la d'abord depuis l'écran Bible."}
          </p>
        </div>
      )}
      <FormMessage state={state} />
    </form>
  );
}
