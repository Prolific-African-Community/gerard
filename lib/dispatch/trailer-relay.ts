import {
  TrailerCustodyState,
  TrailerLoadStatus,
  TrailerStatus,
} from "@prisma/client";

export type TrailerRelayEligibilityInput = {
  loadStatus: TrailerLoadStatus;
  status: TrailerStatus;
  custodyState: TrailerCustodyState;
};

export function getTrailerRelayEligibility(
  trailer: TrailerRelayEligibilityInput,
) {
  if (trailer.loadStatus !== TrailerLoadStatus.LOADED) {
    return {
      eligible: false as const,
      reason: "La remorque n’est pas déclarée chargée.",
    };
  }

  if (trailer.status !== TrailerStatus.AT_BASE) {
    return {
      eligible: false as const,
      reason: "La remorque chargée doit être déclarée à la Base.",
    };
  }

  if (trailer.custodyState !== TrailerCustodyState.RELAY_AVAILABLE) {
    return {
      eligible: false as const,
      reason:
        "La garde de la remorque n’est pas ouverte à une reprise de relais.",
    };
  }

  return { eligible: true as const, reason: null };
}

export function appendRelayTransition(
  current: unknown,
  transition: Record<string, unknown>,
) {
  return [...(Array.isArray(current) ? current : []), transition];
}

export const trailerCustodyLabels: Record<TrailerCustodyState, string> = {
  EMPTY: "Vide · disponible",
  LOADED: "Chargée",
  IN_MISSION: "Chargée · en mission",
  AT_BASE: "Chargée · à la base",
  RELAY_AVAILABLE: "Chargée · à la base · relais possible",
  DELIVERED: "Livrée",
  IMMOBILIZED: "Indisponible",
};
