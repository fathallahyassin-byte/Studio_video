import type { Metadata } from "next";

export const metadata: Metadata = { title: "Production · Studio" };

export default function ProductionPage() {
  return (
    <section className="flex flex-col gap-2">
      <h1 className="font-display text-[44px]">Production</h1>
      <p className="text-muted">Le socle est en place. Le tableau de production arrive à l&apos;étape 2.</p>
    </section>
  );
}
