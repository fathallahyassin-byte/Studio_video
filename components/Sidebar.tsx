"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { logout } from "@/app/(dashboard)/actions";

const NAV = [
  { href: "/production", label: "Production" },
  { href: "/validations", label: "À valider", badge: true },
  { href: "/agents", label: "Agents" },
  { href: "/bible", label: "Bible" },
  { href: "/stats", label: "Statistiques" },
] as const;

type SidebarProps = {
  niche: string;
  queueCount: number;
  workingCount: number;
};

export function Sidebar({ niche, queueCount, workingCount }: SidebarProps) {
  const pathname = usePathname();

  return (
    <aside className="flex w-full shrink-0 flex-col gap-5 bg-ink px-3.5 py-4 text-white md:sticky md:top-0 md:h-screen md:w-[248px] md:gap-6 md:py-5">
      <div className="flex items-center gap-2.5 px-2 py-1">
        <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true">
          <circle cx="16" cy="16" r="11" fill="none" stroke="#fff" strokeWidth="4" strokeDasharray="56 13.1" transform="rotate(-60 16 16)" />
          <circle cx="16" cy="5" r="4" fill="#FFD60A" />
        </svg>
        <span className="text-[21px] font-[850] tracking-[-0.02em]">studio</span>
      </div>

      <nav aria-label="Navigation" className="flex flex-row flex-wrap gap-1 md:flex-col">
        {NAV.map((item) => {
          const current = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const showBadge = "badge" in item && queueCount > 0;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={current ? "page" : undefined}
              className={`flex min-h-11 items-center justify-between gap-2.5 rounded-xl px-3.5 text-[15px] font-semibold transition-colors duration-150 ${
                current ? "bg-wait text-ink" : "text-sidebar-text hover:bg-sidebar-hover hover:text-white"
              }`}
            >
              <span>{item.label}</span>
              {showBadge ? (
                <span className="inline-flex h-[22px] min-w-6 items-center justify-center rounded-full bg-white px-[7px] text-xs font-bold text-ink">
                  <span className="sr-only">éléments en attente : </span>
                  {queueCount}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>

      <div className="flex flex-col gap-3 md:mt-auto">
        <div className="rounded-[14px] bg-[#141516] p-3.5">
          <p className="text-[13px] text-[#A3A6AB]">Chaîne en cours</p>
          <p className="mt-0.5 font-bold">{niche}</p>
          <p className="mt-2 flex items-center gap-2 text-[13px] text-sidebar-text">
            <span aria-hidden="true" className={`size-2 rounded-full ${workingCount > 0 ? "animate-pulse bg-[#1A9E5C]" : "bg-[#55585D]"}`} />
            {workingCount === 0 ? "Aucun agent au travail" : workingCount === 1 ? "1 agent travaille" : `${workingCount} agents travaillent`}
          </p>
        </div>
        <form action={logout}>
          <button
            type="submit"
            className="flex min-h-11 w-full items-center rounded-xl px-3.5 text-left text-[15px] font-semibold text-sidebar-text transition-colors duration-150 hover:bg-sidebar-hover hover:text-white"
          >
            Se déconnecter
          </button>
        </form>
      </div>
    </aside>
  );
}
