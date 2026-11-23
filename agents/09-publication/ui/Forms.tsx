"use client";

import { useId, useState } from "react";
import { buttonClass, FieldLabel, fieldClass, FormMessage } from "@/components/ui";
import { useKeptForm } from "@/components/useKeptForm";
import { MAX_KEYWORDS_LENGTH } from "../settings";
import { markPublishedAction, saveKeywordsAction, savePlatformTextsAction, type PublicationFormState } from "./actions";
import type { PlatformCardView, PlatformTextsView } from "./overview";

export function KeywordsForm({ keywords }: { keywords: string }) {
  const { state, pending, onSubmit } = useKeptForm<PublicationFormState>(saveKeywordsAction, null);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <FieldLabel htmlFor="publication-keywords">Mots-clés de la niche et requêtes observées</FieldLabel>
      <p id="publication-keywords-help" className="text-sm text-muted">
        Un par ligne, écrits comme les gens les tapent dans la barre de recherche. L&apos;agent les reçoit dans {"{{MOTS_CLES}}"} ; vide, il les déduit du script.
      </p>
      <textarea
        id="publication-keywords"
        name="motsCles"
        rows={6}
        maxLength={MAX_KEYWORDS_LENGTH}
        defaultValue={keywords}
        aria-describedby="publication-keywords-help"
        className={`${fieldClass} min-h-32 resize-y text-sm`}
      />
      <FormMessage state={state} />
      <div>
        <button type="submit" className={buttonClass("ghost")} disabled={pending}>
          {pending ? "Enregistrement…" : "Enregistrer les mots-clés"}
        </button>
      </div>
    </form>
  );
}

type Field = { name: string; label: string; value: string; multiline: boolean; help?: string };

function fieldsFor(card: PlatformCardView, texts: PlatformTextsView): Field[] {
  const fields: Field[] = [];
  if (texts.title !== null) fields.push({ name: "titre", label: "Titre (40 à 70 caractères, mot-clé au début)", value: texts.title, multiline: false });
  fields.push({ name: card.platform === "YOUTUBE" ? "description" : "legende", label: card.platform === "YOUTUBE" ? "Description" : "Légende", value: texts.body, multiline: true });
  fields.push({ name: "hashtags", label: "Hashtags", value: texts.hashtags, multiline: false, help: "Séparés par des espaces ; le # est ajouté s'il manque." });
  if (texts.cover !== null) fields.push({ name: "texte_couverture", label: "Texte de couverture (3 à 5 mots)", value: texts.cover, multiline: false });
  if (texts.pinned !== null) fields.push({ name: "commentaire_epingle", label: "Commentaire épinglé", value: texts.pinned, multiline: false });
  return fields;
}

export function PlatformTextsForm({ videoId, card, texts }: { videoId: string; card: PlatformCardView; texts: PlatformTextsView }) {
  const { state, pending, onSubmit } = useKeptForm<PublicationFormState>(savePlatformTextsAction, null);
  const prefix = useId();
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <input type="hidden" name="videoId" value={videoId} />
      <input type="hidden" name="platform" value={card.platform} />
      {fieldsFor(card, texts).map((field) => (
        <TextField key={field.name} id={`${prefix}-${field.name}`} field={field} />
      ))}
      <div className="flex flex-col gap-1.5">
        <FieldLabel htmlFor={`${prefix}-creneau`}>Créneau (heure du serveur)</FieldLabel>
        <input id={`${prefix}-creneau`} name="creneau" type="datetime-local" required defaultValue={card.slotValue} className={fieldClass} />
      </div>
      <FormMessage state={state} />
      <div>
        <button type="submit" className={buttonClass("ink")} disabled={pending}>
          {pending ? "Enregistrement…" : `Enregistrer ${card.label}`}
        </button>
      </div>
    </form>
  );
}

function TextField({ id, field }: { id: string; field: Field }) {
  const helpId = `${id}-help`;
  return (
    <div className="flex flex-col gap-1.5">
      <FieldLabel htmlFor={id}>{field.label}</FieldLabel>
      {field.help ? (
        <p id={helpId} className="text-[13px] text-muted">
          {field.help}
        </p>
      ) : null}
      {field.multiline ? (
        <textarea id={id} name={field.name} rows={4} defaultValue={field.value} aria-describedby={field.help ? helpId : undefined} className={`${fieldClass} resize-y`} />
      ) : (
        <input id={id} name={field.name} type="text" defaultValue={field.value} aria-describedby={field.help ? helpId : undefined} className={fieldClass} />
      )}
    </div>
  );
}

export function CopyCaptionButton({ caption, label }: { caption: string; label: string }) {
  const [message, setMessage] = useState<string | null>(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(caption);
      setMessage("Légende copiée.");
    } catch {
      setMessage("Copie impossible : sélectionne le texte à la main.");
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" onClick={copy} className={buttonClass("ghost")}>
        Copier la légende {label}
      </button>
      <span role="status" className="text-sm">
        {message}
      </span>
    </div>
  );
}

export function MarkPublishedForm({ publicationId, label, hasRender }: { publicationId: string; label: string; hasRender: boolean }) {
  const { state, pending, onSubmit } = useKeptForm<PublicationFormState>(markPublishedAction, null);
  const id = useId();
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      <input type="hidden" name="publicationId" value={publicationId} />
      <FieldLabel htmlFor={id}>Lien de la publication (facultatif)</FieldLabel>
      <input id={id} name="lien" type="url" inputMode="url" placeholder="https://" className={fieldClass} />
      {!hasRender ? <p className="text-[13px] text-muted">Aucun MP4 rendu : vérifie le fichier publié.</p> : null}
      <FormMessage state={state} />
      <div>
        <button type="submit" className={buttonClass("ink")} disabled={pending}>
          {pending ? "Enregistrement…" : `Marquer comme publié sur ${label}`}
        </button>
      </div>
    </form>
  );
}
