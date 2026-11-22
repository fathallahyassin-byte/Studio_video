/** Remplace ou ajoute des lignes CLE="valeur" dans le contenu d'un fichier .env, sans toucher aux autres lignes. */
export function upsertEnvValues(content: string, values: Readonly<Record<string, string>>): string {
  const lines = content === "" ? [] : content.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
  const pending = new Map(Object.entries(values));
  const updated = lines.map((line) => {
    const key = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line)?.[1];
    const value = key === undefined ? undefined : pending.get(key);
    if (key === undefined || value === undefined) return line;
    pending.delete(key);
    return formatLine(key, value);
  });
  for (const [key, value] of pending) updated.push(formatLine(key, value));
  return `${updated.join("\n")}\n`;
}

function formatLine(key: string, value: string): string {
  if (/["\\$\n]/.test(value)) throw new Error(`Valeur non prise en charge pour ${key}`);
  return `${key}="${value}"`;
}
