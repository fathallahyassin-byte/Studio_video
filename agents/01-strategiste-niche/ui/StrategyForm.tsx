"use client";

import { buttonClass, FieldLabel, fieldClass, FormMessage } from "@/components/ui";
import { useKeptForm } from "@/components/useKeptForm";
import { adoptBibleAction, launchStrategyAction, type StrategyFormState } from "./actions";
import type { FormDefaults } from "./view";

const hintClass = "text-[13px] text-muted";

function NumberField({ id, label, hint, defaultValue }: { id: keyof FormDefaults; label: string; hint: string; defaultValue: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <FieldLabel htmlFor={`strategie-${id}`}>{label}</FieldLabel>
      <input
        id={`strategie-${id}`}
        name={id}
        type="text"
        inputMode="decimal"
        required
        defaultValue={defaultValue}
        aria-describedby={`strategie-${id}-aide`}
        className={fieldClass}
      />
      <p id={`strategie-${id}-aide`} className={hintClass}>
        {hint}
      </p>
    </div>
  );
}

function LinesField({ id, label, hint, defaultValue }: { id: keyof FormDefaults; label: string; hint: string; defaultValue: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <FieldLabel htmlFor={`strategie-${id}`}>{label}</FieldLabel>
      <textarea id={`strategie-${id}`} name={id} defaultValue={defaultValue} aria-describedby={`strategie-${id}-aide`} className={`${fieldClass} min-h-28 resize-y`} />
      <p id={`strategie-${id}-aide`} className={hintClass}>
        {hint}
      </p>
    </div>
  );
}

/** Formulaire de lancement : ses valeurs partent dans AgentJob.payload, validées par Zod côté serveur. */
export function StrategyForm({ defaults }: { defaults: FormDefaults }) {
  const { state, pending, onSubmit } = useKeptForm<StrategyFormState>(launchStrategyAction, null);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(280px,100%),1fr))] gap-x-6 gap-y-4">
        <LinesField id="pistes" label="Pistes de niches (une par ligne)" hint="Facultatif : sous 8 pistes, le stratège complète jusqu'à 12 niches." defaultValue={defaults.pistes} />
        <LinesField id="refus" label="Ce que je refuse de faire (une ligne par refus)" hint="Ex. : montrer mon visage, parler de politique." defaultValue={defaults.refus} />
        <NumberField id="heuresParSemaine" label="Heures par semaine" hint="Temps que tu peux consacrer à la chaîne." defaultValue={defaults.heuresParSemaine} />
        <NumberField id="budgetMensuel" label="Budget mensuel (€)" hint="Outils et générations IA compris." defaultValue={defaults.budgetMensuel} />
        <div className="flex flex-col gap-1.5">
          <FieldLabel htmlFor="strategie-objectifRevenus">Objectif de revenus</FieldLabel>
          <input
            id="strategie-objectifRevenus"
            name="objectifRevenus"
            type="text"
            required
            maxLength={300}
            placeholder="Ex. : 500 € par mois dans 12 mois"
            defaultValue={defaults.objectifRevenus}
            className={fieldClass}
          />
        </div>
      </div>
      <FormMessage state={state} />
      <div>
        <button type="submit" className={buttonClass("ink")} disabled={pending}>
          {pending ? "Mise en file…" : "Lancer l'analyse des niches"}
        </button>
      </div>
    </form>
  );
}

/** « Adopter cette bible » : bouton jaune, le brouillon attend la décision de l'humain. */
export function AdoptForm({ versionId, version }: { versionId: string; version: number }) {
  const { state, pending, onSubmit } = useKeptForm<StrategyFormState>(adoptBibleAction, null);
  return (
    <form onSubmit={onSubmit} className="flex flex-col items-start gap-3">
      <input type="hidden" name="versionId" value={versionId} />
      <button type="submit" className={buttonClass("hi")} disabled={pending} aria-describedby="adopter-aide">
        {pending ? "Adoption…" : "Adopter cette bible"}
      </button>
      <p id="adopter-aide" className={hintClass}>
        Le brouillon v{version} devient la bible de tous les agents. Aucune version existante n&apos;est modifiée : tu pourras revenir en arrière depuis l&apos;écran Bible.
      </p>
      <FormMessage state={state} />
    </form>
  );
}
