// Textes d'en-tête du panneau (fonctions pures).

export type Availability = { enabled: boolean; note: string | null };

export const NO_TTS_NOTE =
  "Aucun moteur de synthèse vocale n'est branché : « Régénérer la voix » est désactivé. Le texte reste modifiable pour préparer la prochaine voix.";

export function regenerationAvailability(tts: string | null): Availability {
  return tts === null ? { enabled: false, note: NO_TTS_NOTE } : { enabled: true, note: null };
}

/** Disponibilité de la voix (désactivée), de la voix sur un plan précis (non enregistré, après le rendu). */
export function voiceAvailability(global: Availability, plan: { saved: boolean; editable: boolean }): Availability {
  if (!global.enabled) return global;
  if (!plan.editable) return { enabled: false, note: "Le rendu est lancé ou passé : la voix ne se régénère plus à cette étape." };
  if (!plan.saved) return { enabled: false, note: "La première voix se génère à l'étape Visuels et son : relance l'étape une fois la cause du blocage réglée." };
  return global;
}

export function providerNotes(names: { tts: string | null; stt: string | null; music: string | null }): string[] {
  return [
    names.tts ? `Voix : ${names.tts}.` : "Aucun moteur de synthèse vocale branché : la voix n'est pas générée et la vidéo est bloquée après le plan sonore.",
    names.stt ? `Horodatage de secours : ${names.stt}.` : null,
    names.music ? `Musique : ${names.music}.` : "Aucune banque de musique branchée : choisis chaque piste à la main, avec sa licence.",
  ].filter((note) => note !== null);
}
