"use client";

import Link from "next/link";
import { useId, useState, type ReactNode } from "react";
import { buttonClass, Chip, FieldLabel, fieldClass, FormMessage, PendingNote } from "@/components/ui";
import { useKeptForm } from "@/components/useKeptForm";
import { chooseMusicAction, regenerateVoiceAction, type AudioFormState } from "./actions";
import type { AudioView } from "./audioPlans";
import { MAX_LICENSE_LENGTH, MAX_TEXT_LENGTH, MAX_TITLE_LENGTH, MAX_URL_LENGTH } from "./limits";
import { voiceAvailability, type Availability } from "./summary";

// Liste des plans sonores à gauche, détail à droite. Le jaune ne sert qu'à ce qui attend l'humain.

const textWrap = "[overflow-wrap:anywhere]";

export function AudioBrowser({ plans, regeneration }: { plans: AudioView[]; regeneration: Availability }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = plans.find((plan) => plan.videoId === selectedId) ?? plans[0] ?? null;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(220px,280px)_minmax(0,1fr)]">
      <PlanList plans={plans} selectedId={selected?.videoId ?? null} onSelect={setSelectedId} />
      {selected ? <AudioDetail key={selected.videoId} plan={selected} regeneration={voiceAvailability(regeneration, selected)} /> : null}
    </div>
  );
}

function PlanList({ plans, selectedId, onSelect }: { plans: AudioView[]; selectedId: string | null; onSelect: (id: string) => void }) {
  return (
    <ul aria-label="Plans sonores récents" className="flex min-w-0 flex-col gap-2">
      {plans.map((plan) => {
        const isSelected = plan.videoId === selectedId;
        return (
          <li key={plan.videoId}>
            <button
              type="button"
              aria-pressed={isSelected}
              onClick={() => onSelect(plan.videoId)}
              className={`flex w-full flex-col gap-2 rounded-2xl px-4 py-3 text-left transition-colors duration-150 ${
                isSelected ? "bg-ink text-white" : "bg-white text-text shadow-[inset_0_0_0_1px_var(--color-line)] hover:bg-paper"
              }`}
            >
              <span className={`text-[15px] font-bold ${textWrap}`}>
                {plan.label} · {plan.title}
              </span>
              <span className="flex flex-wrap gap-1.5">
                <Chip tone={plan.status.tone}>{plan.status.label}</Chip>
                {plan.voice ? <Chip tone="run">Voix {plan.voice.seconds}</Chip> : null}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function AudioDetail({ plan, regeneration }: { plan: AudioView; regeneration: Availability }) {
  const titleId = useId();
  return (
    <article aria-labelledby={titleId} className="flex min-w-0 flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-bold text-muted">
            {plan.label} · mis à jour {plan.updatedLabel}
            {plan.saved ? "" : " · dernière proposition du modèle, pas encore enregistrée"}
          </p>
          <h3 id={titleId} className={`font-display mt-1 text-[28px] ${textWrap}`}>
            {plan.title}
          </h3>
        </div>
        <Chip tone={plan.status.tone}>{plan.status.label}</Chip>
      </header>

      {plan.status.notice ? <AwaitingNotice videoId={plan.videoId} notice={plan.status.notice} /> : null}
      <VoiceSection plan={plan} regeneration={regeneration} />
      <MusicSection plan={plan} />
      <SoundDesign plan={plan} />
    </article>
  );
}

function AwaitingNotice({ videoId, notice }: { videoId: string; notice: string }) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-wait p-4 text-ink">
      <p className={`font-bold ${textWrap}`}>{notice}</p>
      <Link href={`/validations?item=${videoId}`} className={`${buttonClass("ink")} self-start`}>
        Ouvrir dans Validations
      </Link>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <h4 className="text-[17px] font-[750] text-ink">{title}</h4>
      {children}
    </section>
  );
}

function VoiceSection({ plan, regeneration }: { plan: AudioView; regeneration: Availability }) {
  const { voice } = plan;
  return (
    <Section title="Voix">
      {voice ? (
        <div className="flex flex-col gap-2 rounded-2xl bg-paper p-4">
          <audio controls preload="metadata" src={voice.url} aria-label={`Voix générée : ${plan.title}`} className="w-full" />
          <p className="text-[14px] text-text">
            {voice.durationLabel} · cible {plan.targetLabel}
            {voice.inTarget ? "" : " · hors cible"}
          </p>
          <p className={`text-[13px] text-muted ${textWrap}`}>
            {voice.attemptLabel} · {voice.timingLabel}
          </p>
          {voice.appliedCuts.length > 0 ? <TextList label="Coupes appliquées" items={voice.appliedCuts} /> : null}
        </div>
      ) : (
        <p className="text-[14px] text-muted">Pas encore de voix générée pour cette vidéo.</p>
      )}
      <RegenerateForm plan={plan} regeneration={regeneration} />
      <Pronunciations items={plan.pronunciations} />
      <Directions items={plan.directions} />
    </Section>
  );
}

function RegenerateForm({ plan, regeneration }: { plan: AudioView; regeneration: Availability }) {
  const textId = useId();
  const { state, pending, onSubmit } = useKeptForm<AudioFormState>(regenerateVoiceAction, null);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      <input type="hidden" name="videoId" value={plan.videoId} />
      <FieldLabel htmlFor={textId}>Texte TTS (balises du moteur comprises)</FieldLabel>
      <textarea id={textId} name="text" rows={8} maxLength={MAX_TEXT_LENGTH} defaultValue={plan.text} className={`${fieldClass} text-[14px] leading-relaxed`} />
      <button type="submit" disabled={!regeneration.enabled || pending} className={`${buttonClass("ink")} self-start`}>
        {pending ? "Génération…" : "Régénérer la voix"}
      </button>
      {regeneration.note ? <PendingNote>{regeneration.note}</PendingNote> : null}
      <FormMessage state={state} />
    </form>
  );
}

function Pronunciations({ items }: { items: AudioView["pronunciations"] }) {
  if (items.length === 0) return <p className="text-[14px] text-muted">Aucune prononciation particulière.</p>;
  return (
    <div className="flex flex-col gap-1.5">
      <h5 className="text-[14px] font-bold text-ink">Prononciations</h5>
      <dl className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-4 gap-y-1 text-[14px]">
        {items.map((item) => (
          <div key={item.word} className="contents">
            <dt className={`font-bold ${textWrap}`}>{item.word}</dt>
            <dd className={`font-mono text-[13px] ${textWrap}`}>{item.phonetic}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function Directions({ items }: { items: AudioView["directions"] }) {
  return (
    <div className="flex flex-col gap-1.5">
      <h5 className="text-[14px] font-bold text-ink">Direction par beat</h5>
      <ul className="flex flex-col gap-1 text-[14px]">
        {items.map((item) => (
          <li key={item.beat} className={textWrap}>
            <span className="font-bold">Beat {item.beat}</span> · {item.tone} · {item.speed}
            {item.emphasis ? ` · appuyer : ${item.emphasis}` : ""}
          </li>
        ))}
      </ul>
    </div>
  );
}

function MusicSection({ plan }: { plan: AudioView }) {
  const { brief, track } = plan;
  return (
    <Section title="Musique">
      <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-[14px] sm:grid-cols-[minmax(0,auto)_minmax(0,1fr)]">
        <Term label="Ambiance" value={`${brief.mood} · ${brief.bpm}`} />
        <Term label="Instruments" value={brief.instruments} />
        <Term label="Évolution" value={brief.evolution} />
        <Term label="Mots-clés" value={brief.keywords} />
        <Term label="Licence requise" value={brief.license} />
      </dl>
      {track ? (
        <div className="flex flex-col gap-1 rounded-2xl bg-paper p-4 text-[14px]">
          <p className={`font-bold text-ink ${textWrap}`}>Piste : {track.title}</p>
          <p className={textWrap}>Licence : {track.license}</p>
          <p className={`text-muted ${textWrap}`}>
            {track.source} ·{" "}
            <a href={track.url} target="_blank" rel="noreferrer" className="underline">
              écouter
            </a>
          </p>
        </div>
      ) : (
        <p className="text-[14px] text-muted">Aucune piste choisie pour l&apos;instant.</p>
      )}
      {plan.editable ? <MusicForm videoId={plan.videoId} hasTrack={track !== null} /> : null}
    </Section>
  );
}

function Term({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="font-bold text-ink">{label}</dt>
      <dd className={textWrap}>{value || "—"}</dd>
    </>
  );
}

function MusicForm({ videoId, hasTrack }: { videoId: string; hasTrack: boolean }) {
  const titleId = useId();
  const urlId = useId();
  const licenseId = useId();
  const { state, pending, onSubmit } = useKeptForm<AudioFormState>(chooseMusicAction, null);
  return (
    <details className="rounded-xl bg-paper p-3">
      <summary className="cursor-pointer text-[14px] font-bold text-ink">{hasTrack ? "Changer de piste" : "Choisir une piste"}</summary>
      <form onSubmit={onSubmit} className="mt-3 flex flex-col gap-2">
        <input type="hidden" name="videoId" value={videoId} />
        <FieldLabel htmlFor={titleId}>Titre de la piste</FieldLabel>
        <input id={titleId} name="title" required maxLength={MAX_TITLE_LENGTH} className={fieldClass} />
        <FieldLabel htmlFor={urlId}>Adresse du fichier (http ou https)</FieldLabel>
        <input id={urlId} name="url" type="url" required maxLength={MAX_URL_LENGTH} className={fieldClass} />
        <FieldLabel htmlFor={licenseId}>Licence (obligatoire : usage commercial sur les 3 plateformes)</FieldLabel>
        <textarea id={licenseId} name="license" required rows={2} maxLength={MAX_LICENSE_LENGTH} className={fieldClass} />
        <button type="submit" disabled={pending} className={`${buttonClass("ink")} self-start`}>
          {pending ? "Enregistrement…" : "Enregistrer la piste"}
        </button>
        <FormMessage state={state} />
      </form>
    </details>
  );
}

function SoundDesign({ plan }: { plan: AudioView }) {
  return (
    <Section title="Effets et mixage">
      <ul className="flex flex-col gap-1 text-[14px]">
        {plan.effects.map((effect) => (
          <li key={`${effect.time}-${effect.effect}`} className={textWrap}>
            <span className="font-bold tabular-nums">{effect.time}</span> · {effect.effect} · {effect.plan}
          </li>
        ))}
      </ul>
      <p className={`text-[14px] ${textWrap}`}>{plan.mix}</p>
      {plan.proposedCuts.length > 0 ? <TextList label="Coupes proposées si la voix est trop longue" items={plan.proposedCuts} /> : null}
    </Section>
  );
}

function TextList({ label, items }: { label: string; items: string[] }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-[13px] font-bold text-ink">{label}</p>
      <ul className="flex list-disc flex-col gap-0.5 pl-5 text-[14px]">
        {items.map((item) => (
          <li key={item} className={textWrap}>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
