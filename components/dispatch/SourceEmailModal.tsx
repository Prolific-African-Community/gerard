"use client";

import { useEffect, useMemo, useState } from "react";

import type { MissionSourceEmailResponse } from "../../lib/mail/types";

type SourceEmailModalProps = {
  isOpen: boolean;
  sourceEmail: MissionSourceEmailResponse | null;
  onClose: () => void;
};

function formatDate(value: string | null | undefined) {
  if (!value) {
    return "Non renseignée";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatAddresses(values: string[] | undefined) {
  if (!values || values.length === 0) {
    return "Non renseigné";
  }

  return values.join(", ");
}

export function SourceEmailModal({
  isOpen,
  sourceEmail,
  onClose,
}: SourceEmailModalProps) {
  const [showRaw, setShowRaw] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setShowRaw(false);
      return;
    }

    setShowRaw(false);
  }, [isOpen, sourceEmail?.sourceEmailId, sourceEmail?.previewKey]);

  const displayedBody = useMemo(() => {
    if (!sourceEmail) {
      return "";
    }

    if (showRaw && sourceEmail.rawBodyText) {
      return sourceEmail.rawBodyText;
    }

    return (
      sourceEmail.cleanedBodyText ??
      sourceEmail.bodyPreview ??
      sourceEmail.rawBodyText ??
      "Aucun contenu disponible."
    );
  }, [showRaw, sourceEmail]);

  if (!isOpen || !sourceEmail) {
    return null;
  }

  async function copyText(value: string) {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // no-op
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/35 px-4 py-6 backdrop-blur-[2px]">
      <div className="flex h-[min(88vh,860px)] w-[min(960px,96vw)] flex-col overflow-hidden rounded-[30px] border border-black/10 bg-white shadow-[0_24px_80px_rgba(17,18,15,0.2)]">
        <div className="flex items-start justify-between gap-4 border-b border-black/10 px-6 py-5">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#73796d]">
              EMAIL SOURCE
            </p>
            <h2 className="mt-2 truncate text-2xl font-semibold tracking-tight text-[#11120f]">
              {sourceEmail.subject ?? "Email source"}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-black/10 bg-white px-4 py-2 text-xs font-semibold text-[#565c51] transition hover:border-lime-300 hover:text-[#405c08]"
          >
            Fermer
          </button>
        </div>

        <div className="grid gap-4 border-b border-black/10 px-6 py-5 text-sm text-[#2f332c] md:grid-cols-2">
          <Meta label="Source" value={sourceEmail.provider ?? sourceEmail.source} />
          <Meta label="Date" value={formatDate(sourceEmail.receivedAt)} />
          <Meta
            label="De"
            value={
              sourceEmail.fromName
                ? `${sourceEmail.fromName} <${sourceEmail.fromAddress ?? ""}>`
                : sourceEmail.fromAddress ?? "Non renseigné"
            }
          />
          <Meta label="À" value={formatAddresses(sourceEmail.toAddresses)} />
          <Meta label="Cc" value={formatAddresses(sourceEmail.ccAddresses)} />
          <Meta label="Sujet" value={sourceEmail.subject ?? "Non renseigné"} />
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-black/10 px-6 py-4">
          <button
            type="button"
            onClick={() => void copyText(displayedBody)}
            className="rounded-full border border-black/10 bg-white px-4 py-2 text-xs font-semibold text-[#565c51] transition hover:border-lime-300 hover:text-[#405c08]"
          >
            Copier email
          </button>
          <button
            type="button"
            onClick={() => void copyText(sourceEmail.subject ?? "")}
            className="rounded-full border border-black/10 bg-white px-4 py-2 text-xs font-semibold text-[#565c51] transition hover:border-lime-300 hover:text-[#405c08]"
          >
            Copier sujet
          </button>
          {sourceEmail.rawBodyText ? (
            <button
              type="button"
              onClick={() => setShowRaw((currentValue) => !currentValue)}
              className={[
                "rounded-full border px-4 py-2 text-xs font-semibold transition",
                showRaw
                  ? "border-[#11130f] bg-[#11130f] text-white"
                  : "border-black/10 bg-white text-[#565c51] hover:border-lime-300 hover:text-[#405c08]",
              ].join(" ")}
            >
              {showRaw ? "Voir nettoyé" : "Voir brut"}
            </button>
          ) : null}
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          <pre className="whitespace-pre-wrap break-words rounded-[24px] border border-black/10 bg-[#f8f8f5] p-5 text-sm leading-6 text-[#1c1f18]">
            {displayedBody || "Aucun contenu disponible."}
          </pre>
        </div>
      </div>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#7a8074]">
        {label}
      </p>
      <p className="mt-1 break-words text-sm font-medium text-[#20231d]">
        {value}
      </p>
    </div>
  );
}
