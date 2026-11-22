"use client";

import { buttonClass, FieldLabel, fieldClass, FormMessage } from "@/components/ui";
import { useKeptForm } from "@/components/useKeptForm";
import { MAX_SIGNALS_LENGTH } from "../settings";
import { launchScoutAction, saveSignalsAction, type ScoutFormState } from "./actions";

export function SignalsForm({ signals }: { signals: string }) {
  const { state, pending, onSubmit } = useKeptForm<ScoutFormState>(saveSignalsAction, null);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <FieldLabel htmlFor="scout-signals">Signaux de la semaine</FieldLabel>
      <p id="scout-signals-help" className="text-sm text-muted">
        Tendances TikTok et Google Trends, suggestions de recherche, questions en commentaires, sujets des concurrents, actualité de la niche. Conservés
        d&apos;une semaine à l&apos;autre. Vide : toutes les idées seront marquées « hypothèse ».
      </p>
      <textarea
        id="scout-signals"
        name="signaux"
        rows={8}
        maxLength={MAX_SIGNALS_LENGTH}
        defaultValue={signals}
        aria-describedby="scout-signals-help"
        className={`${fieldClass} min-h-40 resize-y font-mono text-sm`}
      />
      <FormMessage state={state} />
      <div>
        <button type="submit" className={buttonClass("ghost")} disabled={pending}>
          {pending ? "Enregistrement…" : "Enregistrer les signaux"}
        </button>
      </div>
    </form>
  );
}

export function LaunchScoutForm() {
  const { state, pending, onSubmit } = useKeptForm<ScoutFormState>(launchScoutAction, null);
  return (
    <form onSubmit={onSubmit} className="flex flex-col items-start gap-3">
      <button type="submit" className={buttonClass("ink")} disabled={pending}>
        {pending ? "Mise en file…" : "Lancer la veille"}
      </button>
      <FormMessage state={state} />
    </form>
  );
}
