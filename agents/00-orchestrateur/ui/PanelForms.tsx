"use client";

import { buttonClass, FieldLabel, fieldClass, FormMessage } from "@/components/ui";
import { useKeptForm } from "@/components/useKeptForm";
import { answerBlockedVideoAction, setOrchestratorActiveAction } from "./actions";
import { MAX_ANSWER_LENGTH, type PanelFormState } from "./forms";

/** Interrupteur accessible (role="switch") : un vrai bouton qui envoie l'état inverse. */
export function ActivationSwitch({ active }: { active: boolean }) {
  const { state, pending, onSubmit } = useKeptForm<PanelFormState>(setOrchestratorActiveAction, null);
  const track = active ? "bg-ink" : "bg-[#ECEDEA] shadow-[inset_0_0_0_2px_var(--color-field)]";
  const knob = active ? "translate-x-6 bg-white" : "translate-x-0 bg-ink";
  return (
    <form onSubmit={onSubmit} className="flex flex-col items-start gap-3">
      <input type="hidden" name="active" value={String(!active)} />
      <div className="flex flex-wrap items-center gap-3">
        <span id="orchestrator-switch-label" className="font-bold text-ink">
          Orchestrateur
        </span>
        <button
          type="submit"
          role="switch"
          aria-checked={active}
          aria-labelledby="orchestrator-switch-label"
          aria-describedby="orchestrator-switch-help"
          disabled={pending}
          className="inline-flex min-h-11 items-center gap-3 rounded-full py-1 pr-4 pl-1.5 font-bold text-ink hover:bg-[#ECEDEA] disabled:cursor-wait disabled:opacity-60"
        >
          <span aria-hidden="true" className={`relative inline-flex h-7 w-[52px] shrink-0 items-center rounded-full px-1 transition-colors duration-150 ${track}`}>
            <span className={`h-5 w-5 rounded-full transition-transform duration-150 ${knob}`} />
          </span>
          <span>{pending ? "Enregistrement…" : active ? "Activé" : "Désactivé"}</span>
        </button>
      </div>
      <p id="orchestrator-switch-help" className="text-sm text-muted">
        {active
          ? "Il lit l'état de chaque vidéo, contrôle le dernier livrable et propose la prochaine action. Il ne change jamais d'étape et ne valide jamais V1, V2 ou V3."
          : "Désactivé (par défaut) : il n'est jamais appelé, la machine à états pilote seule la production."}
      </p>
      <FormMessage state={state} />
    </form>
  );
}

export function AnswerForm({ videoId }: { videoId: string }) {
  const { state, pending, onSubmit } = useKeptForm<PanelFormState>(answerBlockedVideoAction, null);
  const fieldId = `orchestrator-answer-${videoId}`;
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      <input type="hidden" name="videoId" value={videoId} />
      <FieldLabel htmlFor={fieldId}>Ta réponse</FieldLabel>
      <p id={`${fieldId}-help`} className="text-[13px] text-text">
        Transmise à l&apos;agent comme note de reprise : l&apos;étape bloquée est relancée.
      </p>
      <textarea
        id={fieldId}
        name="reponse"
        rows={3}
        required
        maxLength={MAX_ANSWER_LENGTH}
        aria-describedby={`${fieldId}-help`}
        className={`${fieldClass} min-h-24 resize-y`}
      />
      <FormMessage state={state} />
      <div>
        <button type="submit" className={buttonClass("ink")} disabled={pending}>
          {pending ? "Envoi…" : "Répondre et relancer l'étape"}
        </button>
      </div>
    </form>
  );
}
