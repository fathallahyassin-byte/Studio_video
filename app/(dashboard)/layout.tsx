import type { ReactNode } from "react";
import { Sidebar } from "@/components/Sidebar";
import { requireOwner } from "@/lib/auth/owner";
import { loadCurrentChannel } from "@/lib/dashboard/context";
import { getShellData } from "@/lib/dashboard/queries";
import { getDb } from "@/lib/db";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  await requireOwner();
  const db = getDb();
  const channel = await loadCurrentChannel();

  if (!channel) {
    return (
      <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-3 px-4">
        <h1 className="font-display text-[40px]">Base vide</h1>
        <p className="text-muted">
          Aucune chaîne en base. Lance <code className="font-mono">npm run db:seed</code> pour créer la chaîne et les 11 agents, puis recharge la page.
        </p>
      </main>
    );
  }

  const shell = await getShellData(db, channel.id);
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <Sidebar niche={channel.niche} queueCount={shell.queueCount} workingCount={shell.workingCount} />
      <main className="min-w-0 flex-1 px-4 pt-6 pb-12 sm:px-10 sm:pt-8">
        <div className="flex flex-col gap-6">{children}</div>
      </main>
    </div>
  );
}
