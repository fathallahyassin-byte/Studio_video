/** Rendu vidéo : Remotion sur le worker (docs/decisions.md, 2026-11-23). */
export type RenderRequest = {
  compositionId: string;
  inputProps: Record<string, unknown>;
  /** clé du MP4 dans le stockage : une clé par vidéo et par passage au rendu */
  outputKey: string;
};

export type RenderResult = { url: string; durationS: number; cost: number };

export type RenderProvider = {
  readonly name: string;
  render(request: RenderRequest): Promise<RenderResult>;
};
