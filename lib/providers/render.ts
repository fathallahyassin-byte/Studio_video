/** Rendu vidéo (Remotion Lambda ou machine dédiée, choix à noter dans docs/decisions.md). */
export type RenderProvider = {
  readonly name: string;
  render(request: { compositionId: string; inputProps: Record<string, unknown> }): Promise<{ url: string; durationS: number; cost: number }>;
};
