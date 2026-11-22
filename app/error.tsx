"use client";

import { buttonClass } from "@/components/ui";

export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const unreachable = /DATABASE_URL|ECONNREFUSED|connect|database/i.test(error.message);
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-4 px-4">
      <h1 className="font-display text-[40px]">{unreachable ? "Base injoignable" : "Erreur"}</h1>
      <p className="text-muted">
        {unreachable ? (
          <>
            La base de données ne répond pas. Lance <code className="font-mono">npm run db:up</code>, vérifie <code className="font-mono">DATABASE_URL</code> dans
            <code className="font-mono"> .env.local</code>, puis réessaie.
          </>
        ) : (
          "Cette page n'a pas pu s'afficher. Le détail est dans le terminal du serveur."
        )}
      </p>
      <div>
        <button type="button" onClick={reset} className={buttonClass("ink")}>
          Réessayer
        </button>
      </div>
    </main>
  );
}
