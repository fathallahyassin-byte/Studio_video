"use client";

import { useState } from "react";
import { buttonClass, FieldLabel, fieldClass, FormMessage, Panel } from "@/components/ui";
import { useKeptForm } from "@/components/useKeptForm";
import { createVideoAction, launchScoutAction, type ProductionFormState } from "./actions";

export function ScoutForm() {
  const { state, pending, onSubmit } = useKeptForm<ProductionFormState>(launchScoutAction, null);
  return (
    <form onSubmit={onSubmit} className="flex flex-col items-start gap-3">
      <button type="submit" className={buttonClass("ink")} disabled={pending}>
        {pending ? "Mise en file…" : "Lancer la veille de la semaine"}
      </button>
      <FormMessage state={state} />
    </form>
  );
}

function NewVideoForm({ onCancel }: { onCancel: () => void }) {
  const { state, pending, onSubmit } = useKeptForm<ProductionFormState>(createVideoAction, null);
  return (
    <Panel>
      <form onSubmit={onSubmit} className="flex flex-col gap-4" aria-labelledby="new-video-title">
        <h2 id="new-video-title" className="text-lg font-[750] text-ink">
          Nouvelle vidéo
        </h2>
        <p className="text-sm text-muted">Ton idée est validée d&apos;office (V1) et part directement chez le recherchiste.</p>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(260px,100%),1fr))] gap-4">
          <div className="flex flex-col gap-1.5">
            <FieldLabel htmlFor="new-title">Titre</FieldLabel>
            <input id="new-title" name="title" required minLength={3} maxLength={200} className={fieldClass} placeholder="Pourquoi les boîtes d'œufs ont 6 alvéoles" />
          </div>
          <div className="flex flex-col gap-1.5">
            <FieldLabel htmlFor="new-angle">Angle</FieldLabel>
            <input id="new-angle" name="angle" required minLength={3} maxLength={500} className={fieldClass} placeholder="L'histoire d'un format venu du commerce" />
          </div>
          <div className="flex flex-col gap-1.5">
            <FieldLabel htmlFor="new-revelation">Révélation (facultatif)</FieldLabel>
            <input id="new-revelation" name="revelation" maxLength={500} className={fieldClass} />
          </div>
        </div>
        <FormMessage state={state} />
        <div className="flex flex-wrap gap-2.5">
          <button type="submit" className={buttonClass("ink")} disabled={pending}>
            {pending ? "Création…" : "Créer et lancer la recherche"}
          </button>
          <button type="button" className={buttonClass("ghost")} onClick={onCancel}>
            Annuler
          </button>
        </div>
      </form>
    </Panel>
  );
}

/** Les deux boutons de l'en-tête de Production, et le formulaire « Nouvelle vidéo » qu'ils ouvrent. */
export function ProductionActions() {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex w-full flex-col gap-4">
      <div className="flex flex-wrap items-start gap-2.5">
        <button type="button" className={buttonClass("ghost")} aria-expanded={open} onClick={() => setOpen((value) => !value)}>
          Nouvelle vidéo
        </button>
        <ScoutForm />
      </div>
      {open ? <NewVideoForm onCancel={() => setOpen(false)} /> : null}
    </div>
  );
}
