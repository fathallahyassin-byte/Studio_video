// Comparaison ligne à ligne de la bible proposée et de la bible active (plus longue sous-suite commune).

export type DiffKind = "same" | "added" | "removed";
export type DiffLine = { kind: DiffKind; text: string };

function splitText(text: string): string[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  return lines.at(-1) === "" ? lines.slice(0, -1) : lines;
}

/** Table des longueurs de sous-suites communes, calculée depuis la fin. */
function commonLengths(before: readonly string[], after: readonly string[]): number[][] {
  const table = Array.from({ length: before.length + 1 }, () => new Array<number>(after.length + 1).fill(0));
  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) {
      const row = table[i];
      if (!row) continue;
      row[j] = before[i] === after[j] ? (table[i + 1]?.[j + 1] ?? 0) + 1 : Math.max(table[i + 1]?.[j] ?? 0, row[j + 1] ?? 0);
    }
  }
  return table;
}

/** Lignes retirées de `before`, ajoutées dans `after`, ou communes, dans l'ordre de lecture. */
export function diffLines(before: string, after: string): DiffLine[] {
  const old = splitText(before);
  const next = splitText(after);
  const table = commonLengths(old, next);
  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < old.length || j < next.length) {
    const oldLine = old[i];
    const nextLine = next[j];
    if (oldLine !== undefined && nextLine !== undefined && oldLine === nextLine) {
      lines.push({ kind: "same", text: oldLine });
      i += 1;
      j += 1;
    } else if (oldLine !== undefined && (nextLine === undefined || (table[i + 1]?.[j] ?? 0) >= (table[i]?.[j + 1] ?? 0))) {
      lines.push({ kind: "removed", text: oldLine });
      i += 1;
    } else {
      lines.push({ kind: "added", text: nextLine ?? "" });
      j += 1;
    }
  }
  return lines;
}

export function countChanges(lines: readonly DiffLine[]): { added: number; removed: number } {
  return {
    added: lines.filter((line) => line.kind === "added").length,
    removed: lines.filter((line) => line.kind === "removed").length,
  };
}
