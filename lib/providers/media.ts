// Types partagés par les providers médias.

export type WordTiming = {
  word: string;
  startS: number;
  endS: number;
};

export type GeneratedMedia = {
  url: string;
  /** coût réel, dans la monnaie des budgets */
  cost: number;
  license: string | null;
};
