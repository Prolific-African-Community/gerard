"use client";

import type { ReactNode, SVGProps } from "react";

/**
 * Langage de contrôles unique de Gerard : une seule famille de pills, de
 * boutons icône et de tabs, réutilisée par Planning, Carte, Rentabilité,
 * Factures et Parc. Blanc cassé, noir, accent lime, verre discret.
 */

export const CONTROL_HEIGHT = "h-10";

/** Surface des panneaux flottants (filtres carte, contrôles parc…). */
export const controlPanelClass =
  "rounded-[22px] bg-white/70 shadow-[0_1px_0_rgba(255,255,255,0.8)_inset,0_14px_40px_rgba(17,18,15,0.08)] backdrop-blur-xl";

/** Champ de saisie / select : même lit translucide que les boutons quiet. */
export const controlFieldClass =
  "h-10 w-full rounded-[14px] border-0 bg-black/[0.045] px-3 text-[13px] font-semibold text-[#11130f] outline-none transition placeholder:text-[#8b9085] focus-visible:bg-white focus-visible:ring-2 focus-visible:ring-[var(--brand-accent)]";

/** Lit des tabs (même valeur que SegmentedTabs, pour les vues qui ont leurs propres tabs). */
export const segmentedShellClass =
  "inline-flex items-center gap-0.5 rounded-[16px] bg-black/[0.04] p-0.5";
export const segmentedItemClass =
  "h-9 shrink-0 rounded-[13px] px-3 text-[13px] font-semibold tracking-[-0.01em] transition-all duration-200";
export const segmentedItemActiveClass =
  "bg-[#11130f] text-white shadow-[0_8px_20px_rgba(17,18,15,0.16)]";
export const segmentedItemIdleClass =
  "text-[#636a5e] hover:bg-white/80 hover:text-[#11130f]";

/** Barre de contrôles : une seule surface, quelle que soit la vue. */
export function ControlBar({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={[
        "flex flex-wrap items-center gap-x-2 gap-y-2 rounded-[22px] bg-white/55 px-2 py-2",
        "shadow-[0_1px_0_rgba(255,255,255,0.8)_inset,0_12px_34px_rgba(17,18,15,0.05)] backdrop-blur-xl",
        className,
      ].join(" ")}
    >
      {children}
    </div>
  );
}

/** Regroupement d'actions d'une même famille, séparé par un filet discret. */
export function ControlGroup({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={["flex items-center gap-1", className].join(" ")}>{children}</div>
  );
}

export function ControlDivider() {
  return <span aria-hidden className="mx-1 hidden h-6 w-px bg-black/[0.07] md:block" />;
}

type ControlTone = "quiet" | "solid" | "accent";

const toneStyles: Record<ControlTone, string> = {
  // Silencieux par défaut : rien ne capte l'œil avant le planning.
  quiet:
    "bg-transparent text-[#5f665b] hover:bg-white hover:text-[#11130f] hover:shadow-[0_8px_20px_rgba(17,18,15,0.07)]",
  solid:
    "bg-[#11130f] text-white hover:bg-[#1d211b] hover:shadow-[0_10px_24px_rgba(17,18,15,0.18)]",
  accent:
    "bg-[var(--brand-accent)] text-[#11130f] hover:bg-[var(--brand-accent-hover)] hover:shadow-[0_10px_24px_rgba(140,190,40,0.28)]",
};

const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[#f4f5f1]";

/**
 * Bouton d'action. L'icône porte le sens, le libellé n'apparaît qu'au survol
 * (et reste toujours disponible pour les lecteurs d'écran).
 */
export function ControlButton({
  label,
  icon,
  onClick,
  tone = "quiet",
  showLabel = false,
  disabled = false,
  active = false,
  badge,
  className = "",
}: {
  label: string;
  icon: ReactNode;
  onClick?: () => void;
  tone?: ControlTone;
  /** Affiche le libellé en permanence (actions rares, texte très court). */
  showLabel?: boolean;
  disabled?: boolean;
  active?: boolean;
  badge?: number | null;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={showLabel ? undefined : label}
      style={{ border: 0 }}
      className={[
        "group relative inline-flex shrink-0 items-center justify-center gap-2 rounded-[15px]",
        CONTROL_HEIGHT,
        showLabel ? "px-3.5" : "w-10",
        "appearance-none text-[13px] font-semibold tracking-[-0.01em] outline-none transition-all duration-200",
        disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer",
        active ? "bg-white text-[#11130f] shadow-[0_8px_20px_rgba(17,18,15,0.08)]" : toneStyles[tone],
        focusRing,
        className,
      ].join(" ")}
    >
      <span className="flex h-[18px] w-[18px] items-center justify-center">{icon}</span>
      {showLabel ? <span className="whitespace-nowrap">{label}</span> : null}
      {typeof badge === "number" && badge > 0 ? (
        <span className="absolute -right-0.5 -top-0.5 flex h-[15px] min-w-[15px] items-center justify-center rounded-full bg-[var(--brand-accent)] px-1 text-[9px] font-bold text-[#11130f]">
          {badge}
        </span>
      ) : null}
    </button>
  );
}

/**
 * Tabs de vues. Plus de bordure métallique : un simple lit translucide et une
 * pastille noire pour la vue active.
 */
export function SegmentedTabs<T extends string>({
  value,
  options,
  onChange,
  className = "",
}: {
  value: T;
  options: ReadonlyArray<{ value: T; label: string; icon?: ReactNode }>;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={[
        "inline-flex shrink-0 items-center gap-0.5 rounded-[16px] bg-black/[0.04] p-0.5",
        className,
      ].join(" ")}
    >
      {options.map((option) => {
        const isActive = option.value === value;

        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(option.value)}
            style={{ border: 0 }}
            className={[
              "inline-flex h-9 items-center gap-1.5 rounded-[13px] px-3 text-[13px] font-semibold tracking-[-0.01em]",
              "appearance-none outline-none transition-all duration-200",
              isActive
                ? "bg-[#11130f] text-white shadow-[0_8px_20px_rgba(17,18,15,0.16)]"
                : "text-[#636a5e] hover:bg-white/80 hover:text-[#11130f]",
              focusRing,
            ].join(" ")}
          >
            {option.icon ? (
              <span className="flex h-[15px] w-[15px] items-center justify-center">
                {option.icon}
              </span>
            ) : null}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** Lit translucide pour un groupe de boutons (navigation de semaine, zoom…). */
export function SegmentedShell({ children }: { children: ReactNode }) {
  return (
    <div className="inline-flex shrink-0 items-center gap-0.5 rounded-[16px] bg-black/[0.04] p-0.5">
      {children}
    </div>
  );
}

/* ------------------------- Iconographie ------------------------- */

const iconProps: SVGProps<SVGSVGElement> = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
  className: "h-full w-full",
};

export const Icons = {
  search: () => (
    <svg {...iconProps}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </svg>
  ),
  /** Planification automatique : une trajectoire qui se range d'elle-même. */
  autoPlan: () => (
    <svg {...iconProps}>
      <path d="M3 17c4 0 5-10 9-10 2.2 0 3.2 2.4 3.9 4.8" />
      <path d="m18.4 9.4 1.1 2.9 2.9-1.1" />
      <circle cx="3.6" cy="17" r="1.4" />
    </svg>
  ),
  /** Analyser le planning. */
  analyze: () => (
    <svg {...iconProps}>
      <path d="M4 19V5" />
      <path d="M4 19h16" />
      <path d="m7.5 14.5 3.2-4 3 2.4 4-5.4" />
    </svg>
  ),
  assistant: () => (
    <svg {...iconProps}>
      <path d="M5 5.5h14v10H9l-4 3v-13Z" />
      <path d="M9 9h6M9 12h4" />
    </svg>
  ),
  /** Compléter les lignes de la semaine. */
  addRows: () => (
    <svg {...iconProps}>
      <rect x="3.5" y="4.5" width="17" height="5" rx="1.6" />
      <rect x="3.5" y="12.5" width="9" height="5" rx="1.6" />
      <path d="M17 12.5v7M13.5 16h7" />
    </svg>
  ),
  imports: () => (
    <svg {...iconProps}>
      <path d="M4 5.5h16v13H4z" />
      <path d="m4 6.5 8 6 8-6" />
    </svg>
  ),
  clients: () => (
    <svg {...iconProps}>
      <path d="M4 19.5h16" />
      <path d="M6.5 19.5V8.5A1.5 1.5 0 0 1 8 7h8a1.5 1.5 0 0 1 1.5 1.5v11" />
      <path d="M9.5 11h5M9.5 14.5h5M12 7V4.5" />
    </svg>
  ),
  plus: () => (
    <svg {...iconProps} strokeWidth={2}>
      <path d="M12 5.5v13M5.5 12h13" />
    </svg>
  ),
  chevronLeft: () => (
    <svg {...iconProps} strokeWidth={2}>
      <path d="m14 6-6 6 6 6" />
    </svg>
  ),
  chevronRight: () => (
    <svg {...iconProps} strokeWidth={2}>
      <path d="m10 6 6 6-6 6" />
    </svg>
  ),
  expand: () => (
    <svg {...iconProps}>
      <path d="M9 4.5H4.5V9M15 4.5h4.5V9M9 19.5H4.5V15M15 19.5h4.5V15" />
    </svg>
  ),
  collapse: () => (
    <svg {...iconProps}>
      <path d="M4.5 9H9V4.5M19.5 9H15V4.5M4.5 15H9v4.5M19.5 15H15v4.5" />
    </svg>
  ),
  refresh: () => (
    <svg {...iconProps}>
      <path d="M19.5 12a7.5 7.5 0 1 1-2.6-5.7" />
      <path d="M19.5 4.5V9H15" />
    </svg>
  ),
  filter: () => (
    <svg {...iconProps}>
      <path d="M4 6.5h16M7 12h10M10 17.5h4" />
    </svg>
  ),
  download: () => (
    <svg {...iconProps}>
      <path d="M12 4.5v10M8 11l4 4 4-4" />
      <path d="M4.5 18.5h15" />
    </svg>
  ),
  map: () => (
    <svg {...iconProps}>
      <path d="M12 21s6.5-6.1 6.5-10.5a6.5 6.5 0 1 0-13 0C5.5 14.9 12 21 12 21Z" />
      <circle cx="12" cy="10.5" r="2.3" />
    </svg>
  ),
  chart: () => (
    <svg {...iconProps}>
      <path d="M5 19V9M12 19V5M19 19v-6" />
    </svg>
  ),
  invoice: () => (
    <svg {...iconProps}>
      <path d="M6 3.5h12v17l-3-1.6-3 1.6-3-1.6-3 1.6z" />
      <path d="M9 8h6M9 12h6" />
    </svg>
  ),
  park: () => (
    <svg {...iconProps}>
      <rect x="3.5" y="5.5" width="17" height="13" rx="2" />
      <path d="M9.5 15V9h2.8a2.1 2.1 0 0 1 0 4.2H9.5" />
    </svg>
  ),
  planning: () => (
    <svg {...iconProps}>
      <rect x="3.5" y="5" width="17" height="14" rx="2" />
      <path d="M3.5 9.5h17M8.5 3.5v3M15.5 3.5v3" />
    </svg>
  ),
} as const;
