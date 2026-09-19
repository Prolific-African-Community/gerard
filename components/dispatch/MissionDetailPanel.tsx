"use client";

import type { InputHTMLAttributes, ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

import { AddressAutocomplete } from "./AddressAutocomplete";
import type { AddressPlace } from "./AddressAutocomplete";
import type { CreateMissionFormData } from "./CreateMissionPanel";
import { SourceEmailModal } from "./SourceEmailModal";
import type { ClientProfile } from "../../lib/dispatch/client-profiles";
import {
  buildMissionProfileDefaults,
  findMatchingClientProfile,
} from "../../lib/dispatch/client-profiles";
import type { MissionSourceEmailResponse } from "../../lib/mail/types";
import type {
  DispatchDay,
  Mission,
  MissionStatus,
  Trailer,
} from "../../lib/dispatch/mock-data";
import { dayLabels } from "../../lib/dispatch/mock-data";
import { describeTrailerRotationEvent } from "../../lib/dispatch/trailer-rotation";
import {
  missionCouplingTypeOptions,
  missionTrailerTypeOptions,
} from "../../lib/dispatch/mission-form-options";

const statusLabels: Record<MissionStatus, string> = {
  pending: "À planifier",
  assigned: "Assignée",
  in_progress: "En cours",
  done: "Terminée",
  issue: "Problème",
  cancelled: "Annulée",
};

const statusStyles: Record<MissionStatus, string> = {
  pending: "border-black/10 bg-[#f4f5f1] text-[#56594f]",
  assigned: "border-lime-300 bg-lime-100 text-[#49630b]",
  in_progress: "border-sky-200 bg-sky-100 text-sky-800",
  done: "border-emerald-200 bg-emerald-100 text-emerald-800",
  issue: "border-red-200 bg-red-100 text-red-800",
  cancelled: "border-black/10 bg-[#e6e8e1] text-[#34372f]",
};

const missionStatuses: MissionStatus[] = [
  "pending",
  "assigned",
  "in_progress",
  "done",
  "issue",
  "cancelled",
];

const custodyStateLabels: Record<string, string> = {
  EMPTY: "Vide",
  LOADED: "Chargée",
  IN_MISSION: "En mission",
  AT_BASE: "À la Base",
  RELAY_AVAILABLE: "Relais possible",
  DELIVERED: "Livrée",
  IMMOBILIZED: "Immobilisée",
};

const custodyTransitionStatusLabels: Record<string, string> = {
  PLANNED: "Prévu",
  COMPLETED: "Effectué",
  CANCELLED: "Annulé",
};

type MissionEventType =
  | "CREATED"
  | "ASSIGNED"
  | "UNASSIGNED"
  | "RESCHEDULED"
  | "STATUS_CHANGED"
  | "DRIVER_CHANGED"
  | "TRUCK_CHANGED"
  | "NOTE_ADDED"
  | "COMPLETED"
  | "CANCELLED"
  | "ISSUE_REPORTED";

type MissionEventItem = {
  id: string;
  type: MissionEventType;
  message: string | null;
  fromStatus: string | null;
  toStatus: string | null;
  metadata: unknown;
  createdAt: string;
  actorName: string | null;
  driverName: string | null;
  truckPlateNumber: string | null;
  trailerPlateNumber: string | null;
};

type MissionEventsResponse = {
  events: MissionEventItem[];
};

const eventLabels: Record<MissionEventType, string> = {
  CREATED: "Créée",
  ASSIGNED: "Assignée",
  UNASSIGNED: "Retirée du planning",
  RESCHEDULED: "Replanifiée",
  STATUS_CHANGED: "Statut modifié",
  DRIVER_CHANGED: "Chauffeur modifié",
  TRUCK_CHANGED: "Camion modifié",
  NOTE_ADDED: "Note ajoutée",
  COMPLETED: "Terminée",
  CANCELLED: "Annulée",
  ISSUE_REPORTED: "Problème signalé",
};

type MissionDetailPanelProps = {
  mission: Mission | null;
  clientProfiles?: ClientProfile[];
  driverName?: string;
  truckLabel?: string;
  trailerLabel?: string;
  trailers?: Trailer[];
  plannedTrailerId?: string | null;
  trailerChangePlanned?: boolean;
  onMarkTrailerRelayAvailable?: (mission: Mission) => Promise<void>;
  onCancelTrailerRelay?: (mission: Mission) => Promise<void>;
  day?: DispatchDay;
  onClose: () => void;
  onStatusChange: (missionId: string, status: MissionStatus) => void;
  onUnassign: (missionId: string) => void;
  onUpdate: (data: CreateMissionFormData) => Promise<void>;
  onPlannedTrailerChange?: (missionId: string, trailerId: string | null) => Promise<void>;
  onDelete?: (missionId: string) => Promise<void>;
  onMarkPreAnnouncementSent: (missionId: string) => Promise<void>;
  closeOnOutsideClick?: boolean;
  canEdit?: boolean;
  canAssign?: boolean;
};

type EditFormState = {
  reference: string;
  title: string;
  clientName: string;
  clientReference: string;
  cmrNumber: string;
  deliveryNoteNumber: string;
  plannedTrailerId: string;
  status: MissionStatus;
  pickupCity: string;
  deliveryCity: string;
  pickupAddress: string;
  deliveryAddress: string;
  pickupPlaceId: string;
  deliveryPlaceId: string;
  pickupLat: number | null;
  pickupLng: number | null;
  deliveryLat: number | null;
  deliveryLng: number | null;
  estimatedKm: string;
  pickupDate: string;
  deliveryDate: string;
  requiredTruckType: string;
  requiredCapacityKg: string;
  requiredCargoType: string;
  requiredCouplingType: string;
  priceAmount: string;
  priceCurrency: string;
  paymentTerms: string;
  preAnnouncementRequired: boolean;
  preAnnouncementSent: boolean;
  preAnnouncementSentAt: string;
  strapsRequired: boolean;
  cornerProtectorsRequired: boolean;
  emptyTrailerRequired: boolean;
  safetyVestRequired: boolean;
  coveredTruckRequired: boolean;
  appointmentRequired: boolean;
  loadingRequirementsText: string;
  unloadingRequirementsText: string;
  pickupContactName: string;
  pickupPhone: string;
  pickupEmail: string;
  pickupOpeningHours: string;
  pickupRemarks: string;
  deliveryContactName: string;
  deliveryPhone: string;
  deliveryEmail: string;
  deliveryOpeningHours: string;
  deliveryRemarks: string;
  clientContactName: string;
  clientPhone: string;
  clientEmail: string;
  billingCompanyName: string;
  billingAddress: string;
  billingEmail: string;
  billingInstructions: string;
  notes: string;
};

function getEditFormState(mission: Mission, plannedTrailerId?: string | null): EditFormState {
  const requirements = mission.requirements;
  const contacts = mission.contacts;
  const billingInfo = mission.billingInfo;

  return {
    reference: mission.reference,
    title: mission.shortLabel ?? "",
    clientName: mission.clientName,
    clientReference: mission.clientReference ?? "",
    cmrNumber: mission.cmrNumber ?? "",
    deliveryNoteNumber: mission.deliveryNoteNumber ?? "",
    plannedTrailerId: plannedTrailerId ?? "",
    status: mission.status,
    pickupCity: mission.pickupCity,
    deliveryCity: mission.deliveryCity,
    pickupAddress: mission.pickupAddress ?? "",
    deliveryAddress: mission.deliveryAddress ?? "",
    pickupPlaceId: mission.pickupPlaceId ?? "",
    deliveryPlaceId: mission.deliveryPlaceId ?? "",
    pickupLat: mission.pickupLat ?? null,
    pickupLng: mission.pickupLng ?? null,
    deliveryLat: mission.deliveryLat ?? null,
    deliveryLng: mission.deliveryLng ?? null,
    estimatedKm:
      typeof mission.estimatedKm === "number" && mission.estimatedKm > 0
        ? String(mission.estimatedKm)
        : "",
    pickupDate: toDatetimeLocalValue(mission.pickupDate),
    deliveryDate: toDatetimeLocalValue(mission.deliveryDate),
    requiredTruckType:
      getJsonString(requirements, "requiredTrailerType") ??
      mission.requiredTruckType ??
      "",
    requiredCapacityKg:
      getJsonNumber(requirements, "requiredCapacityKg")?.toString() ?? "",
    requiredCargoType:
      getJsonString(requirements, "requiredCargoType") ?? "",
    requiredCouplingType:
      getJsonString(requirements, "requiredCouplingType") ?? "",
    priceAmount:
      typeof mission.priceAmount === "number" ? String(mission.priceAmount) : "",
    priceCurrency: mission.priceCurrency ?? "EUR",
    paymentTerms: mission.paymentTerms ?? "",
    preAnnouncementRequired: mission.preAnnouncementRequired ?? false,
    preAnnouncementSent: mission.preAnnouncementSent ?? false,
    preAnnouncementSentAt: toDatetimeLocalValue(mission.preAnnouncementSentAt),
    strapsRequired:
      getJsonBoolean(requirements, "strapsRequired") ??
      getJsonBoolean(requirements, "straps") ??
      false,
    cornerProtectorsRequired:
      getJsonBoolean(requirements, "cornerProtectorsRequired") ??
      getJsonBoolean(requirements, "protectiveCorners") ??
      false,
    emptyTrailerRequired:
      getJsonBoolean(requirements, "emptyTrailerRequired") ??
      getJsonBoolean(requirements, "emptyTrailer") ??
      false,
    safetyVestRequired:
      getJsonBoolean(requirements, "safetyVestRequired") ??
      getJsonBoolean(requirements, "safetyVest") ??
      false,
    coveredTruckRequired:
      getJsonBoolean(requirements, "coveredTruckRequired") ?? false,
    appointmentRequired:
      getJsonBoolean(requirements, "appointmentRequired") ?? false,
    loadingRequirementsText: getJsonString(requirements, "loadingRequirementsText") ?? "",
    unloadingRequirementsText:
      getJsonString(requirements, "unloadingRequirementsText") ?? "",
    pickupContactName: getJsonString(contacts, "pickupContactName") ?? "",
    pickupPhone: getJsonString(contacts, "pickupPhone") ?? "",
    pickupEmail: getJsonString(contacts, "pickupEmail") ?? "",
    pickupOpeningHours: getJsonString(contacts, "pickupOpeningHours") ?? "",
    pickupRemarks: getJsonString(contacts, "pickupRemarks") ?? "",
    deliveryContactName: getJsonString(contacts, "deliveryContactName") ?? "",
    deliveryPhone: getJsonString(contacts, "deliveryPhone") ?? "",
    deliveryEmail: getJsonString(contacts, "deliveryEmail") ?? "",
    deliveryOpeningHours: getJsonString(contacts, "deliveryOpeningHours") ?? "",
    deliveryRemarks: getJsonString(contacts, "deliveryRemarks") ?? "",
    clientContactName: getJsonString(contacts, "clientContactName") ?? "",
    clientPhone: getJsonString(contacts, "clientPhone") ?? "",
    clientEmail: getJsonString(contacts, "clientEmail") ?? "",
    billingCompanyName:
      getJsonString(billingInfo, "billingCompanyName") ??
      getJsonString(billingInfo, "companyName") ??
      "",
    billingAddress:
      getJsonString(billingInfo, "billingAddress") ??
      getJsonString(billingInfo, "address") ??
      "",
    billingEmail:
      getJsonString(billingInfo, "billingEmail") ??
      getJsonString(billingInfo, "invoiceEmail") ??
      "",
    billingInstructions:
      getJsonString(billingInfo, "billingInstructions") ??
      getJsonString(billingInfo, "instructions") ??
      "",
    notes: mission.notes ?? "",
  };
}

export function MissionDetailPanel({
  mission,
  clientProfiles = [],
  driverName,
  truckLabel,
  trailerLabel,
  trailers = [],
  plannedTrailerId,
  trailerChangePlanned,
  onMarkTrailerRelayAvailable,
  onCancelTrailerRelay,
  day,
  onClose,
  onStatusChange,
  onUnassign,
  onUpdate,
  onPlannedTrailerChange,
  onDelete,
  onMarkPreAnnouncementSent,
  closeOnOutsideClick = true,
  canEdit = true,
  canAssign = true,
}: MissionDetailPanelProps) {
  const panelRef = useRef<HTMLElement | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [formState, setFormState] = useState<EditFormState | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [selectedClientProfileId, setSelectedClientProfileId] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [sourceEmail, setSourceEmail] =
    useState<MissionSourceEmailResponse | null>(null);
  const [isSourceEmailOpen, setIsSourceEmailOpen] = useState(false);
  const [isLoadingSourceEmail, setIsLoadingSourceEmail] = useState(false);
  const [sourceEmailError, setSourceEmailError] = useState<string | null>(null);
  const [events, setEvents] = useState<MissionEventItem[]>([]);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [isLoadingEvents, setIsLoadingEvents] = useState(false);
  const [isMarkingPreAnnouncement, setIsMarkingPreAnnouncement] =
    useState(false);

  useEffect(() => {
    if (mission) {
      setFormState(getEditFormState(mission, plannedTrailerId));
      setIsEditing(false);
      setEditError(null);
    }
  }, [mission?.id]);

  useEffect(() => {
    if (!mission) return;
    const matchingProfile = findMatchingClientProfile(
      clientProfiles,
      mission.clientName,
    );
    setSelectedClientProfileId(matchingProfile?.id ?? "");
  }, [clientProfiles, mission?.clientName, mission?.id]);

  useEffect(() => {
    setIsSourceEmailOpen(false);
    setSourceEmail(null);
    setSourceEmailError(null);
    setIsLoadingSourceEmail(false);
  }, [mission?.id]);

  useEffect(() => {
    if (!mission || !closeOnOutsideClick || isSourceEmailOpen) {
      return;
    }

    function handlePointerDown(event: MouseEvent | TouchEvent) {
      const target = event.target;

      if (!(target instanceof Node)) {
        return;
      }

      if (panelRef.current?.contains(target)) {
        return;
      }

      onClose();
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeOnOutsideClick, isSourceEmailOpen, mission, onClose]);

  useEffect(() => {
    if (!mission) {
      setEvents([]);
      return;
    }

    const controller = new AbortController();
    const missionId = mission.id;

    async function loadEvents() {
      try {
        setIsLoadingEvents(true);
        setEventsError(null);

        const response = await fetch(
          `/api/dispatch/mission-events?missionId=${encodeURIComponent(
            missionId,
          )}`,
          {
            signal: controller.signal,
          },
        );

        if (!response.ok) {
          throw new Error(`Mission events API returned ${response.status}`);
        }

        const data = (await response.json()) as MissionEventsResponse;
        setEvents(data.events);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        console.error("Unable to load mission events", error);
        setEventsError("Historique indisponible.");
      } finally {
        setIsLoadingEvents(false);
      }
    }

    loadEvents();

    return () => controller.abort();
  }, [mission]);

  const selectedClientProfile = useMemo(() => {
    if (!selectedClientProfileId) {
      return null;
    }

    return (
      clientProfiles.find((profile) => profile.id === selectedClientProfileId) ??
      null
    );
  }, [clientProfiles, selectedClientProfileId]);

  if (!mission) {
    return null;
  }

  const visibleMission = mission;
  const isAssigned = Boolean(driverName || truckLabel || trailerLabel || day);
  const currentFormState = formState ?? getEditFormState(visibleMission, plannedTrailerId);
  const hasTransportOrder = hasTransportOrderData(visibleMission);
  const requirementBadges = getRequirementBadges(visibleMission.requirements);
  const invoiceEmail = getJsonString(visibleMission.billingInfo, "invoiceEmail");
  const billingInstruction = getJsonString(
    visibleMission.billingInfo,
    "instructions",
  );
  const contactItems = getMissionContactItems(visibleMission.contacts);
  const isEditValid =
    currentFormState.reference.trim().length > 0 &&
    currentFormState.clientName.trim().length > 0 &&
    currentFormState.pickupCity.trim().length > 0 &&
    currentFormState.deliveryCity.trim().length > 0;
  function updateField<Field extends keyof EditFormState>(
    field: Field,
    value: EditFormState[Field],
  ) {
    setFormState((currentState) => ({
      ...(currentState ?? getEditFormState(visibleMission)),
      [field]: value,
    }));
  }

  function applyClientProfile(profile: ClientProfile, force = false) {
    const defaults = buildMissionProfileDefaults(profile);

    setFormState((currentState) => {
      const baseState = currentState ?? getEditFormState(visibleMission);
      const nextNotes = [baseState.notes.trim(), defaults.notes?.trim()]
        .filter(Boolean)
        .filter((value, index, values) => values.indexOf(value) === index)
        .join("\n\n");

      function getNextValue<T extends string | boolean>(
        currentValue: T,
        nextValue: T | undefined,
      ) {
        if (typeof nextValue === "undefined") {
          return currentValue;
        }

        if (typeof currentValue === "boolean") {
          return (force ? nextValue : currentValue || nextValue) as T;
        }

        return (force || currentValue.trim().length === 0
          ? nextValue
          : currentValue) as T;
      }

      return {
        ...baseState,
        clientName: getNextValue(baseState.clientName, defaults.clientName ?? ""),
        paymentTerms: getNextValue(
          baseState.paymentTerms,
          defaults.paymentTerms ?? "",
        ),
        requiredTruckType: getNextValue(
          baseState.requiredTruckType,
          defaults.requiredTruckType ?? "",
        ),
        preAnnouncementRequired:
          force || !baseState.preAnnouncementRequired
            ? defaults.preAnnouncementRequired ?? baseState.preAnnouncementRequired
            : baseState.preAnnouncementRequired,
        strapsRequired:
          force || !baseState.strapsRequired
            ? defaults.strapsRequired ?? baseState.strapsRequired
            : baseState.strapsRequired,
        cornerProtectorsRequired:
          force || !baseState.cornerProtectorsRequired
            ? defaults.cornerProtectorsRequired ??
              baseState.cornerProtectorsRequired
            : baseState.cornerProtectorsRequired,
        emptyTrailerRequired:
          force || !baseState.emptyTrailerRequired
            ? defaults.emptyTrailerRequired ?? baseState.emptyTrailerRequired
            : baseState.emptyTrailerRequired,
        safetyVestRequired:
          force || !baseState.safetyVestRequired
            ? defaults.safetyVestRequired ?? baseState.safetyVestRequired
            : baseState.safetyVestRequired,
        coveredTruckRequired:
          force || !baseState.coveredTruckRequired
            ? defaults.coveredTruckRequired ?? baseState.coveredTruckRequired
            : baseState.coveredTruckRequired,
        appointmentRequired:
          force || !baseState.appointmentRequired
            ? defaults.appointmentRequired ?? baseState.appointmentRequired
            : baseState.appointmentRequired,
        loadingRequirementsText: getNextValue(
          baseState.loadingRequirementsText,
          defaults.loadingRequirementsText ?? "",
        ),
        clientContactName: getNextValue(
          baseState.clientContactName,
          defaults.clientContactName ?? "",
        ),
        clientPhone: getNextValue(
          baseState.clientPhone,
          defaults.clientPhone ?? "",
        ),
        clientEmail: getNextValue(
          baseState.clientEmail,
          defaults.clientEmail ?? "",
        ),
        billingCompanyName: getNextValue(
          baseState.billingCompanyName,
          defaults.billingCompanyName ?? "",
        ),
        billingAddress: getNextValue(
          baseState.billingAddress,
          defaults.billingAddress ?? "",
        ),
        billingEmail: getNextValue(
          baseState.billingEmail,
          defaults.billingEmail ?? "",
        ),
        billingInstructions: getNextValue(
          baseState.billingInstructions,
          defaults.billingInstructions ?? "",
        ),
        notes:
          force && defaults.notes
            ? nextNotes
            : baseState.notes.trim().length === 0
            ? defaults.notes ?? baseState.notes
            : baseState.notes,
      };
    });
  }

  function getOptionalValue(value: string) {
    const trimmedValue = value.trim();

    return trimmedValue.length > 0 ? trimmedValue : undefined;
  }

  function getOptionalNumber(value: string) {
    const trimmedValue = value.trim();

    if (!trimmedValue) {
      return undefined;
    }

    const numberValue = Number(trimmedValue.replace(",", "."));

    return Number.isFinite(numberValue) ? numberValue : null;
  }

  function buildRequirements(): Record<string, unknown> {
    return {
      ...(visibleMission.requirements ?? {}),
      requiredTrailerType: getOptionalValue(
        currentFormState.requiredTruckType,
      )?.toUpperCase() ?? null,
      requiredCapacityKg:
        getOptionalNumber(currentFormState.requiredCapacityKg) ?? null,
      requiredCouplingType: getOptionalValue(
        currentFormState.requiredCouplingType,
      )?.toUpperCase() ?? null,
    };
  }

  function buildContacts(): Record<string, unknown> {
    return {
      pickupContactName: getOptionalValue(currentFormState.pickupContactName),
      pickupPhone: getOptionalValue(currentFormState.pickupPhone),
      pickupEmail: getOptionalValue(currentFormState.pickupEmail),
      pickupOpeningHours: getOptionalValue(
        currentFormState.pickupOpeningHours,
      ),
      pickupRemarks: getOptionalValue(currentFormState.pickupRemarks),
      deliveryContactName: getOptionalValue(
        currentFormState.deliveryContactName,
      ),
      deliveryPhone: getOptionalValue(currentFormState.deliveryPhone),
      deliveryEmail: getOptionalValue(currentFormState.deliveryEmail),
      deliveryOpeningHours: getOptionalValue(
        currentFormState.deliveryOpeningHours,
      ),
      deliveryRemarks: getOptionalValue(currentFormState.deliveryRemarks),
      clientContactName: getOptionalValue(currentFormState.clientContactName),
      clientPhone: getOptionalValue(currentFormState.clientPhone),
      clientEmail: getOptionalValue(currentFormState.clientEmail),
    };
  }

  function buildBillingInfo(): Record<string, unknown> {
    const billingEmail = getOptionalValue(currentFormState.billingEmail);
    const billingInstructions = getOptionalValue(
      currentFormState.billingInstructions,
    );

    return {
      billingCompanyName: getOptionalValue(
        currentFormState.billingCompanyName,
      ),
      companyName: getOptionalValue(currentFormState.billingCompanyName),
      billingAddress: getOptionalValue(currentFormState.billingAddress),
      address: getOptionalValue(currentFormState.billingAddress),
      billingEmail,
      invoiceEmail: billingEmail,
      billingInstructions,
      instructions: billingInstructions,
      paymentTerms: getOptionalValue(currentFormState.paymentTerms),
    };
  }

  async function handleSave() {
    const estimatedKm = getOptionalNumber(currentFormState.estimatedKm);
    const priceAmount = getOptionalNumber(currentFormState.priceAmount);
    const requiredCapacityKg = getOptionalNumber(
      currentFormState.requiredCapacityKg,
    );

    if (!isEditValid) {
      setEditError("Référence, client, départ et livraison sont obligatoires.");
      return;
    }

    if (
      estimatedKm === null ||
      (typeof estimatedKm === "number" && estimatedKm < 0)
    ) {
      setEditError("La distance estimée doit être un nombre positif.");
      return;
    }

    if (
      priceAmount === null ||
      (typeof priceAmount === "number" && priceAmount < 0)
    ) {
      setEditError("Le prix doit être un nombre positif.");
      return;
    }
    if (
      requiredCapacityKg === null ||
      (typeof requiredCapacityKg === "number" && requiredCapacityKg <= 0)
    ) {
      setEditError("La capacité remorque doit être un nombre positif.");
      return;
    }

    try {
      setIsSaving(true);
      setEditError(null);

      await onUpdate({
        reference: currentFormState.reference.trim(),
        title: getOptionalValue(currentFormState.title),
        clientName: currentFormState.clientName.trim(),
        clientReference: getOptionalValue(currentFormState.clientReference),
        cmrNumber: getOptionalValue(currentFormState.cmrNumber),
        deliveryNoteNumber: getOptionalValue(currentFormState.deliveryNoteNumber),
        status: currentFormState.status,
        pickupCity: currentFormState.pickupCity.trim(),
        deliveryCity: currentFormState.deliveryCity.trim(),
        pickupAddress: getOptionalValue(currentFormState.pickupAddress),
        deliveryAddress: getOptionalValue(currentFormState.deliveryAddress),
        pickupPlaceId: getOptionalValue(currentFormState.pickupPlaceId),
        deliveryPlaceId: getOptionalValue(currentFormState.deliveryPlaceId),
        pickupLat: currentFormState.pickupLat ?? undefined,
        pickupLng: currentFormState.pickupLng ?? undefined,
        deliveryLat: currentFormState.deliveryLat ?? undefined,
        deliveryLng: currentFormState.deliveryLng ?? undefined,
        estimatedKm:
          typeof estimatedKm === "number" ? Math.round(estimatedKm) : undefined,
        pickupDate: getOptionalValue(currentFormState.pickupDate),
        deliveryDate: getOptionalValue(currentFormState.deliveryDate),
        requiredTruckType: null,
        priceAmount:
          typeof priceAmount === "number" ? priceAmount : undefined,
        priceCurrency: getOptionalValue(currentFormState.priceCurrency),
        paymentTerms: getOptionalValue(currentFormState.paymentTerms),
        preAnnouncementRequired: currentFormState.preAnnouncementRequired,
        preAnnouncementSent: currentFormState.preAnnouncementSent,
        preAnnouncementSentAt: getOptionalValue(
          currentFormState.preAnnouncementSentAt,
        ),
        requirements: buildRequirements(),
        contacts: buildContacts(),
        billingInfo: buildBillingInfo(),
        notes: getOptionalValue(currentFormState.notes),
      });
      if (
        onPlannedTrailerChange &&
        currentFormState.plannedTrailerId !== (plannedTrailerId ?? "")
      ) {
        await onPlannedTrailerChange(
          visibleMission.id,
          currentFormState.plannedTrailerId || null,
        );
      }

      setIsEditing(false);
    } catch (error) {
      console.error("Unable to update mission", error);
      setEditError(
        error instanceof Error
          ? error.message
          : "Impossible de modifier la mission.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete() {
    if (!onDelete || !visibleMission) {
      return;
    }

    const confirmed = window.confirm(
      "Supprimer cet élément ? Cette action est définitive.",
    );

    if (!confirmed) {
      return;
    }

    try {
      setIsDeleting(true);
      setDeleteError(null);
      await onDelete(visibleMission.id);
      onClose();
    } catch (error) {
      setDeleteError(
        error instanceof Error
          ? error.message
          : "Impossible de supprimer la mission.",
      );
    } finally {
      setIsDeleting(false);
    }
  }

  function handlePickupAddressChange(value: string) {
    setFormState((currentState) => ({
      ...(currentState ?? getEditFormState(visibleMission)),
      pickupAddress: value,
      pickupPlaceId: "",
      pickupLat: null,
      pickupLng: null,
    }));
  }

  function handleDeliveryAddressChange(value: string) {
    setFormState((currentState) => ({
      ...(currentState ?? getEditFormState(visibleMission)),
      deliveryAddress: value,
      deliveryPlaceId: "",
      deliveryLat: null,
      deliveryLng: null,
    }));
  }

  function handlePickupPlaceSelect(place: AddressPlace) {
    setFormState((currentState) => ({
      ...(currentState ?? getEditFormState(visibleMission)),
      pickupAddress: place.label,
      pickupPlaceId: place.placeId,
      pickupLat: place.lat ?? null,
      pickupLng: place.lng ?? null,
    }));
  }

  function handleDeliveryPlaceSelect(place: AddressPlace) {
    setFormState((currentState) => ({
      ...(currentState ?? getEditFormState(visibleMission)),
      deliveryAddress: place.label,
      deliveryPlaceId: place.placeId,
      deliveryLat: place.lat ?? null,
      deliveryLng: place.lng ?? null,
    }));
  }

  async function handleMarkPreAnnouncementSent() {
    try {
      setIsMarkingPreAnnouncement(true);
      await onMarkPreAnnouncementSent(visibleMission.id);
    } catch (error) {
      console.error("Unable to mark preannouncement sent", error);
    } finally {
      setIsMarkingPreAnnouncement(false);
    }
  }

  async function handleOpenSourceEmail() {
    if (!visibleMission) {
      return;
    }

    try {
      setIsLoadingSourceEmail(true);
      setSourceEmailError(null);
      setSourceEmail(null);
      setIsSourceEmailOpen(false);

      const response = await fetch(
        `/api/dispatch/missions/${visibleMission.id}/source-email`,
      );
      const payload = (await response.json()) as
        | MissionSourceEmailResponse
        | { error?: string };

      if (!response.ok) {
        throw new Error(
          "error" in payload && payload.error
            ? payload.error
            : "Aucun email source enregistré pour cette mission.",
        );
      }

      setSourceEmail(payload as MissionSourceEmailResponse);
      setIsSourceEmailOpen(true);
    } catch (error) {
      setSourceEmailError(
        error instanceof Error
          ? error.message
          : "Aucun email source enregistré pour cette mission.",
      );
    } finally {
      setIsLoadingSourceEmail(false);
    }
  }

  function handleCloseSourceEmail() {
    setIsSourceEmailOpen(false);
    setSourceEmail(null);
    setSourceEmailError(null);
  }

  return (
    <>
    <aside
      ref={panelRef}
      className="fixed right-4 top-4 z-50 flex h-[calc(100vh-32px)] w-[620px] max-w-[92vw] flex-col rounded-[32px] border border-black/10 bg-white p-6 shadow-[0_24px_80px_rgba(17,18,15,0.18)] backdrop-blur-xl"
    >
      <div className="flex items-start justify-between gap-6 border-b border-black/10 pb-1">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#73796d]">
            DÉTAIL MISSION
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h2 className="truncate text-3xl font-semibold tracking-tight text-[#11120f]">
              {mission.clientReference || mission.reference}
            </h2>
            <span
              className={[
                "rounded-full border px-2.5 py-1 text-[11px] font-semibold",
                statusStyles[mission.status],
              ].join(" ")}
            >
              {statusLabels[mission.status]}
            </span>
          </div>
          {mission.clientReference ? (
            <p className="mt-1 text-xs font-semibold text-[#7a8074]">
              Interne : {mission.reference}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => void handleOpenSourceEmail()}
            disabled={isLoadingSourceEmail}
            className="rounded-full border border-black/10 bg-white px-4 py-2 text-xs font-semibold text-[#565c51] shadow-[0_1px_8px_rgba(17,18,15,0.05)] transition hover:border-lime-300 hover:text-[#405c08] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isLoadingSourceEmail ? "Chargement..." : "Email source"}
          </button>
          {!isEditing && canEdit ? (
            <button
              type="button"
              onClick={() => setIsEditing(true)}
              className="rounded-full border border-black/10 bg-white px-4 py-2 text-xs font-semibold text-[#565c51] shadow-[0_1px_8px_rgba(17,18,15,0.05)] transition hover:border-lime-300 hover:text-[#405c08]"
            >
              Modifier
            </button>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-black/10 bg-white px-4 py-2 text-xs font-semibold text-[#565c51] shadow-[0_1px_8px_rgba(17,18,15,0.05)] transition hover:border-lime-300 hover:text-[#405c08]"
          >
            Fermer
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {sourceEmailError ? (
          <div className="mt-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-semibold text-amber-800">
            {sourceEmailError}
          </div>
        ) : null}

        {!isEditing ? (
          <label className="mt-2 pb-5 block">
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#73796d]">
              Statut
            </span>
            <select
              value={mission.status}
              onChange={(event) =>
                onStatusChange(mission.id, event.target.value as MissionStatus)
              }
              disabled={!canEdit}
              className="mt-2 h-12 w-full rounded-2xl border border-black/10 bg-white px-4 text-sm font-semibold text-[#171814] shadow-[0_1px_10px_rgba(17,18,15,0.045)] outline-none transition focus:border-lime-300 focus:ring-4 focus:ring-lime-200/35"
            >
              {missionStatuses.map((status) => (
                <option key={status} value={status}>
                  {statusLabels[status]}
                </option>
              ))}
            </select>
          </label>
        ) : null}


        {isEditing ? (
          <div className="space-y-4">
            <EditSection title="Essentiel">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <EditSelect
                  label="Profil client"
                  value={selectedClientProfileId}
                  onChange={(value) => {
                    setSelectedClientProfileId(value);
                    const profile = clientProfiles.find(
                      (item) => item.id === value,
                    );

                    if (profile) {
                      applyClientProfile(profile, false);
                    }
                  }}
                  options={[
                    { value: "", label: "Aucun profil" },
                    ...clientProfiles.map((profile) => ({
                      value: profile.id,
                      label: profile.name,
                    })),
                  ]}
                />
                <div className="flex items-end">
                  <button
                    type="button"
                    disabled={!selectedClientProfile}
                    onClick={() => {
                      if (selectedClientProfile) {
                        applyClientProfile(selectedClientProfile, true);
                      }
                    }}
                    className="h-12 w-full rounded-2xl border border-black/10 bg-[#f4f5f1] px-4 text-sm font-semibold text-[#2f332c] transition hover:border-lime-300 hover:bg-lime-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Appliquer les valeurs du profil
                  </button>
                </div>
                <EditField
                  label="Référence client"
                  value={currentFormState.clientReference}
                  onChange={(value) => updateField("clientReference", value)}
                />
                <EditField
                  label="Référence interne"
                  value={currentFormState.reference}
                  onChange={(value) => updateField("reference", value)}
                  required
                />
                <EditField
                  label="Numéro CMR"
                  value={currentFormState.cmrNumber}
                  onChange={(value) => updateField("cmrNumber", value)}
                />
                <EditField
                  label="Bon de livraison"
                  value={currentFormState.deliveryNoteNumber}
                  onChange={(value) => updateField("deliveryNoteNumber", value)}
                />
                <EditSelect
                  label="Remorque planifiée"
                  value={currentFormState.plannedTrailerId}
                  onChange={(value) => updateField("plannedTrailerId", value)}
                  options={[
                    { value: "", label: "Non assignée" },
                    ...trailers
                      .filter(
                        (trailer) =>
                          trailer.id === plannedTrailerId ||
                          (!["IN_MAINTENANCE", "MAINTENANCE_EXT", "OUT_OF_SERVICE"].includes(
                            trailer.status,
                          ) &&
                            trailer.custodyState !== "IMMOBILIZED"),
                      )
                      .map((trailer) => ({
                        value: trailer.id,
                        label: `${trailer.plateNumber} · ${custodyStateLabels[trailer.custodyState ?? "EMPTY"] ?? trailer.status}`,
                      })),
                  ]}
                />
                <EditField
                  label="Client"
                  value={currentFormState.clientName}
                  onChange={(value) => updateField("clientName", value)}
                  required
                />
                <EditField
                  label="Libellé court"
                  value={currentFormState.title}
                  onChange={(value) => updateField("title", value)}
                />
                <EditSelect
                  label="Statut"
                  value={currentFormState.status}
                  onChange={(value) =>
                    updateField("status", value as MissionStatus)
                  }
                  options={missionStatuses.map((status) => ({
                    value: status,
                    label: statusLabels[status],
                  }))}
                />
                <EditField
                  label="Distance estimée"
                  value={currentFormState.estimatedKm}
                  onChange={(value) => updateField("estimatedKm", value)}
                  inputMode="numeric"
                />
              </div>
            </EditSection>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <EditSection title="Chargement">
                <div className="space-y-3">
                  <EditField
                    label="Ville départ"
                    value={currentFormState.pickupCity}
                    onChange={(value) => updateField("pickupCity", value)}
                    required
                  />
                  <AddressAutocomplete
                    label="Adresse départ"
                    value={currentFormState.pickupAddress}
                    placeId={currentFormState.pickupPlaceId}
                    onChange={handlePickupAddressChange}
                    onSelect={handlePickupPlaceSelect}
                  />
                  <EditField
                    label="Date chargement"
                    value={currentFormState.pickupDate}
                    onChange={(value) => updateField("pickupDate", value)}
                    type="datetime-local"
                  />
                  <EditField
                    label="Contact chargement"
                    value={currentFormState.pickupContactName}
                    onChange={(value) =>
                      updateField("pickupContactName", value)
                    }
                  />
                  <EditField
                    label="Téléphone chargement"
                    value={currentFormState.pickupPhone}
                    onChange={(value) => updateField("pickupPhone", value)}
                  />
                  <EditField
                    label="Email chargement"
                    value={currentFormState.pickupEmail}
                    onChange={(value) => updateField("pickupEmail", value)}
                  />
                  <EditField
                    label="Horaires chargement"
                    value={currentFormState.pickupOpeningHours}
                    onChange={(value) =>
                      updateField("pickupOpeningHours", value)
                    }
                  />
                  <EditTextarea
                    label="Remarques chargement"
                    value={currentFormState.pickupRemarks}
                    onChange={(value) => updateField("pickupRemarks", value)}
                  />
                </div>
              </EditSection>

              <EditSection title="Livraison">
                <div className="space-y-3">
                  <EditField
                    label="Ville livraison"
                    value={currentFormState.deliveryCity}
                    onChange={(value) => updateField("deliveryCity", value)}
                    required
                  />
                  <AddressAutocomplete
                    label="Adresse livraison"
                    value={currentFormState.deliveryAddress}
                    placeId={currentFormState.deliveryPlaceId}
                    onChange={handleDeliveryAddressChange}
                    onSelect={handleDeliveryPlaceSelect}
                  />
                  <EditField
                    label="Date livraison"
                    value={currentFormState.deliveryDate}
                    onChange={(value) => updateField("deliveryDate", value)}
                    type="datetime-local"
                  />
                  <EditField
                    label="Contact livraison"
                    value={currentFormState.deliveryContactName}
                    onChange={(value) =>
                      updateField("deliveryContactName", value)
                    }
                  />
                  <EditField
                    label="Téléphone livraison"
                    value={currentFormState.deliveryPhone}
                    onChange={(value) => updateField("deliveryPhone", value)}
                  />
                  <EditField
                    label="Email livraison"
                    value={currentFormState.deliveryEmail}
                    onChange={(value) => updateField("deliveryEmail", value)}
                  />
                  <EditField
                    label="Horaires livraison"
                    value={currentFormState.deliveryOpeningHours}
                    onChange={(value) =>
                      updateField("deliveryOpeningHours", value)
                    }
                  />
                  <EditTextarea
                    label="Remarques livraison"
                    value={currentFormState.deliveryRemarks}
                    onChange={(value) =>
                      updateField("deliveryRemarks", value)
                    }
                  />
                </div>
              </EditSection>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <EditSection title="Transport & Prix">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <EditSelect
                    label="Type de remorque"
                    value={currentFormState.requiredTruckType}
                    onChange={(value) =>
                      updateField("requiredTruckType", value)
                    }
                    options={missionTrailerTypeOptions}
                  />
                  <EditField
                    label="Capacité remorque minimale (kg)"
                    value={currentFormState.requiredCapacityKg}
                    onChange={(value) =>
                      updateField("requiredCapacityKg", value)
                    }
                    inputMode="numeric"
                  />
                  <EditSelect
                    label="Attelage requis"
                    value={currentFormState.requiredCouplingType}
                    onChange={(value) =>
                      updateField("requiredCouplingType", value)
                    }
                    options={missionCouplingTypeOptions}
                  />
                  <EditField
                    label="Prix"
                    value={currentFormState.priceAmount}
                    onChange={(value) => updateField("priceAmount", value)}
                    inputMode="decimal"
                  />
                  <EditField
                    label="Devise"
                    value={currentFormState.priceCurrency}
                    onChange={(value) => updateField("priceCurrency", value)}
                  />
                  <EditField
                    label="Paiement"
                    value={currentFormState.paymentTerms}
                    onChange={(value) => updateField("paymentTerms", value)}
                  />
                </div>
              </EditSection>

              <EditSection title="Pré-annonce">
                <div className="space-y-3">
                  <EditCheckbox
                    label="Pré-annonce obligatoire"
                    checked={currentFormState.preAnnouncementRequired}
                    onChange={(checked) =>
                      updateField("preAnnouncementRequired", checked)
                    }
                  />
                  <EditCheckbox
                    label="Pré-annonce envoyée"
                    checked={currentFormState.preAnnouncementSent}
                    onChange={(checked) =>
                      updateField("preAnnouncementSent", checked)
                    }
                  />
                  <EditField
                    label="Date envoi"
                    value={currentFormState.preAnnouncementSentAt}
                    onChange={(value) =>
                      updateField("preAnnouncementSentAt", value)
                    }
                    type="datetime-local"
                  />
                </div>
              </EditSection>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <EditSection title="Contact client">
                <div className="space-y-3">
                  <EditField
                    label="Nom contact"
                    value={currentFormState.clientContactName}
                    onChange={(value) =>
                      updateField("clientContactName", value)
                    }
                  />
                  <EditField
                    label="Téléphone"
                    value={currentFormState.clientPhone}
                    onChange={(value) => updateField("clientPhone", value)}
                  />
                  <EditField
                    label="Email"
                    value={currentFormState.clientEmail}
                    onChange={(value) => updateField("clientEmail", value)}
                  />
                </div>
              </EditSection>

              <EditSection title="Facturation">
                <div className="space-y-3">
                  <EditField
                    label="Société"
                    value={currentFormState.billingCompanyName}
                    onChange={(value) =>
                      updateField("billingCompanyName", value)
                    }
                  />
                  <EditField
                    label="Email facture"
                    value={currentFormState.billingEmail}
                    onChange={(value) => updateField("billingEmail", value)}
                  />
                  <EditTextarea
                    label="Adresse facturation"
                    value={currentFormState.billingAddress}
                    onChange={(value) =>
                      updateField("billingAddress", value)
                    }
                  />
                  <EditTextarea
                    label="Instructions"
                    value={currentFormState.billingInstructions}
                    onChange={(value) =>
                      updateField("billingInstructions", value)
                    }
                  />
                </div>
              </EditSection>
            </div>

            <EditSection title="Notes">
              <EditTextarea
                label="Notes"
                value={currentFormState.notes}
                onChange={(value) => updateField("notes", value)}
                rows={4}
              />
            </EditSection>

            {editError ? (
              <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-semibold text-red-700">
                {editError}
              </p>
            ) : null}
          </div>
        ) : (
          <div className="space-y-5">
            <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <DetailItem label="Client" value={mission.clientName} />
              <DetailItem
                label="Distance estimée"
                value={`${mission.estimatedKm} km`}
              />
              <DetailItem label="Départ" value={mission.pickupCity} />
              <DetailItem label="Livraison" value={mission.deliveryCity} />
              <DetailItem
                label="Adresse départ"
                value={mission.pickupAddress ?? "Non renseignée"}
              />
              <DetailItem
                label="Adresse livraison"
                value={mission.deliveryAddress ?? "Non renseignée"}
              />
              <DetailItem label="Chauffeur" value={driverName ?? "Non assigné"} />
              <DetailItem label="Camion" value={truckLabel ?? "Non assigné"} />
              <DetailItem
                label="Remorque planifiée"
                value={trailerLabel ?? "Non assignée"}
              />
              {trailerChangePlanned ? (
                <DetailItem
                  label="Opération remorque"
                  value="Accrochage / décrochage planifié"
                />
              ) : null}
              <DetailItem
                label="Jour"
                value={day ? dayLabels[day] : "Non planifié"}
              />
              <DetailItem
                label="Notes"
                value={mission.notes ?? "Aucune note"}
                className="sm:col-span-2"
              />
            </dl>

            {mission.trailerPlateNumber ? (
              <section className="rounded-[26px] bg-black/[0.025] p-4">
                <h3 className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#73796d]">
                  Relais et chargement
                </h3>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-[#20221d]">
                    {mission.trailerPlateNumber}
                  </span>
                  <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
                    {mission.trailerCustodyLabel ?? "État à confirmer"}
                  </span>
                </div>
                <ol className="mt-3 space-y-2">
                  {(mission.trailerCustodyEvents ?? []).length > 0 ? (
                    mission.trailerCustodyEvents?.map((event) => (
                      <li
                        key={event.id}
                        className="rounded-2xl bg-white px-3 py-2 text-xs text-[#565c51]"
                      >
                        <span className="font-semibold text-[#20221d]">
                          {custodyStateLabels[event.fromState] ??
                            event.fromState}{" "}
                          →{" "}
                          {custodyStateLabels[event.toState] ?? event.toState}
                        </span>
                        {" · "}
                        {new Date(event.occurredAt).toLocaleString("fr-FR")}
                        {event.location ? ` · ${event.location}` : ""}
                        {event.fromDriver?.name
                          ? ` · Déposé par ${event.fromDriver.name}`
                          : ""}
                        {event.toDriver?.name
                          ? ` · Repris par ${event.toDriver.name}`
                          : ""}
                        {event.note ? ` · ${event.note}` : ""}
                        <span className="ml-2 uppercase text-[#8a9085]">
                          {custodyTransitionStatusLabels[event.status] ??
                            event.status}
                        </span>
                      </li>
                    ))
                  ) : (
                    <li className="text-xs font-medium text-[#747a6f]">
                      Aucun relais enregistré.
                    </li>
                  )}
                </ol>
                {canAssign &&
                onMarkTrailerRelayAvailable &&
                mission.trailerCustodyState !== "RELAY_AVAILABLE" ? (
                  <button
                    type="button"
                    onClick={() => void onMarkTrailerRelayAvailable(mission)}
                    className="mt-3 rounded-full bg-[#11130f] px-4 py-2 text-xs font-semibold text-white transition hover:bg-[#c8ff00] hover:text-black"
                  >
                    Déposer à la Base pour relais
                  </button>
                ) : null}
                {canAssign &&
                onCancelTrailerRelay &&
                mission.trailerCustodyState === "RELAY_AVAILABLE" ? (
                  <button
                    type="button"
                    onClick={() => void onCancelTrailerRelay(mission)}
                    className="mt-3 rounded-full border border-black/10 bg-white px-4 py-2 text-xs font-semibold text-[#565c51] transition hover:border-red-200 hover:text-red-700"
                  >
                    Annuler le relais
                  </button>
                ) : null}
              </section>
            ) : null}

            {hasTransportOrder ? (
              <section className="rounded-[26px] bg-black/[0.025] p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#73796d]">
                    Ordre transport
                  </h3>
                  {mission.preAnnouncementRequired ? (
                    <span className="rounded-full border border-lime-300 bg-lime-100 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#49630b]">
                      Pré-annonce obligatoire
                    </span>
                  ) : null}
                </div>

                <dl className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <MiniDetail
                    label="Référence client"
                    value={mission.clientReference ?? "Non renseignée"}
                  />
                  <MiniDetail
                    label="Numéro CMR"
                    value={mission.cmrNumber ?? "Non renseigné"}
                  />
                  <MiniDetail
                    label="Bon de livraison"
                    value={mission.deliveryNoteNumber ?? "Non renseigné"}
                  />
                  <MiniDetail
                    label="Type camion"
                    value={
                      getJsonString(
                        mission.requirements,
                        "requiredTrailerType",
                      ) ??
                      mission.requiredTruckType ??
                      "Non précisé"
                    }
                  />
                  <MiniDetail
                    label="Chargement"
                    value={formatMissionDate(mission.pickupDate)}
                  />
                  <MiniDetail
                    label="Livraison"
                    value={formatMissionDate(mission.deliveryDate)}
                  />
                  <MiniDetail
                    label="Prix"
                    value={formatPrice(
                      mission.priceAmount,
                      mission.priceCurrency,
                    )}
                  />
                  <MiniDetail
                    label="Paiement"
                    value={mission.paymentTerms ?? "Non renseigné"}
                  />
                  <MiniDetail
                    label="Pré-annonce"
                    value={
                      mission.preAnnouncementRequired
                        ? mission.preAnnouncementSent
                          ? `Envoyée${mission.preAnnouncementSentAt ? ` · ${formatMissionDate(mission.preAnnouncementSentAt)}` : ""}`
                          : "Non envoyée"
                        : "Non requise"
                    }
                  />
                </dl>

                {mission.preAnnouncementRequired &&
                !mission.preAnnouncementSent ? (
                  <button
                    type="button"
                    onClick={handleMarkPreAnnouncementSent}
                    disabled={isMarkingPreAnnouncement}
                    className="mt-3 rounded-2xl border border-black/10 bg-white px-3 py-2 text-xs font-semibold text-[#303329] transition hover:border-lime-300 hover:text-[#405c08] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isMarkingPreAnnouncement
                      ? "Marquage..."
                      : "Marquer envoyée"}
                  </button>
                ) : null}
              </section>
            ) : null}

            {requirementBadges.length > 0 ? (
              <section className="rounded-[26px] bg-black/[0.025] p-4">
                <h3 className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#73796d]">
                  Contraintes
                </h3>
                <div className="mt-3 flex flex-wrap gap-2">
                  {requirementBadges.map((requirement) => (
                    <span
                      key={requirement}
                      className="rounded-full border border-black/10 bg-white px-3 py-1.5 text-xs font-semibold text-[#303329]"
                    >
                      {requirement}
                    </span>
                  ))}
                </div>
              </section>
            ) : null}

            {contactItems.length > 0 ? (
              <section className="rounded-[26px] bg-black/[0.025] p-4">
                <h3 className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#73796d]">
                  Contacts
                </h3>
                <dl className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {contactItems.map((item) => (
                    <MiniDetail
                      key={`${item.label}:${item.value}`}
                      label={item.label}
                      value={item.value}
                    />
                  ))}
                </dl>
              </section>
            ) : null}

            {invoiceEmail || billingInstruction ? (
              <section className="rounded-[26px] bg-black/[0.025] p-4">
                <h3 className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#73796d]">
                  Facturation
                </h3>
                <div className="mt-3 space-y-2">
                  {invoiceEmail ? (
                    <MiniDetail label="Email facture" value={invoiceEmail} />
                  ) : null}
                  {billingInstruction ? (
                    <p className="rounded-2xl bg-white px-3 py-2 text-xs font-semibold leading-relaxed text-[#565c51]">
                      {billingInstruction}
                    </p>
                  ) : null}
                </div>
              </section>
            ) : null}
          </div>
        )}



        {!isEditing ? (
          <section className="mt-6 border-t border-black/10 pt-5">
            <div className="flex items-center justify-between gap-4">
              <h3 className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#73796d]">
                Historique
              </h3>
              {isLoadingEvents ? (
                <span className="text-[11px] font-semibold text-[#9aa090]">
                  Chargement...
                </span>
              ) : null}
            </div>

            {eventsError ? (
              <p className="mt-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-semibold text-red-700">
                {eventsError}
              </p>
            ) : null}

            {!isLoadingEvents && !eventsError && events.length === 0 ? (
              <p className="mt-3 rounded-2xl bg-black/[0.025] px-4 py-4 text-sm font-medium text-[#7a8074]">
                Aucun événement enregistré.
              </p>
            ) : null}

            {events.length > 0 ? (
              <div className="mt-4 space-y-3">
                {events.map((event) => (
                  <TimelineEvent key={event.id} event={event} />
                ))}
              </div>
            ) : null}
          </section>
        ) : null}
      </div>

      <div className="border-t border-black/10 pt-4">
        {deleteError ? (
          <p className="mb-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-semibold text-red-700">
            {deleteError}
          </p>
        ) : null}
        {isEditing ? (
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => {
                setFormState(getEditFormState(visibleMission));
                setIsEditing(false);
                setEditError(null);
              }}
              className="rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm font-semibold text-[#303329] shadow-[0_1px_10px_rgba(17,18,15,0.045)] transition hover:border-lime-300 hover:text-[#405c08]"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!isEditValid || isSaving}
              className="rounded-2xl bg-[#11130f] px-4 py-3 text-sm font-semibold text-white shadow-[0_12px_32px_rgba(17,18,15,0.15)] transition hover:bg-[#C8FF00] hover:text-black disabled:cursor-not-allowed disabled:bg-black/20 disabled:text-white"
            >
              {isSaving ? "Enregistrement..." : "Enregistrer"}
            </button>
          </div>
        ) : canEdit || canAssign || onDelete ? (
          <div className="grid grid-cols-2 gap-3">
            {onDelete ? <button
              type="button"
              onClick={handleDelete}
              disabled={!onDelete || isDeleting}
              className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-45"
            >
              {isDeleting ? "Suppression..." : "Supprimer"}
            </button> : null}
            {canAssign ? <button
              type="button"
              onClick={() => onUnassign(mission.id)}
              disabled={!isAssigned}
              className="rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm font-semibold text-[#303329] shadow-[0_1px_10px_rgba(17,18,15,0.045)] transition hover:border-red-200 hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-45"
            >
              Retirer du planning
            </button> : null}
          </div>
        ) : null}
      </div>
    </aside>

    <SourceEmailModal
      isOpen={isSourceEmailOpen}
      sourceEmail={sourceEmail}
      onClose={handleCloseSourceEmail}
    />
    </>
  );
}

type EditFieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  inputMode?: InputHTMLAttributes<HTMLInputElement>["inputMode"];
  type?: InputHTMLAttributes<HTMLInputElement>["type"];
};

function EditField({
  label,
  value,
  onChange,
  required = false,
  inputMode,
  type = "text",
}: EditFieldProps) {
  return (
    <label>
      <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#73796d]">
        {label}
        {required ? " *" : ""}
      </span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        inputMode={inputMode}
        type={type}
        className="mt-2 h-12 w-full rounded-2xl border border-black/10 bg-black/[0.025] px-4 text-sm font-semibold text-[#171814] outline-none transition placeholder:text-[#9aa090] focus:border-lime-300 focus:bg-white focus:ring-4 focus:ring-lime-200/35"
      />
    </label>
  );
}

type EditSectionProps = {
  title: string;
  children: ReactNode;
};

function EditSection({ title, children }: EditSectionProps) {
  return (
    <section className="rounded-[26px] bg-black/[0.018] p-4">
      <h3 className="mb-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#73796d]">
        {title}
      </h3>
      {children}
    </section>
  );
}

type EditSelectProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
};

function EditSelect({ label, value, onChange, options }: EditSelectProps) {
  return (
    <label>
      <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#73796d]">
        {label}
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 h-12 w-full rounded-2xl border border-black/10 bg-black/[0.025] px-4 text-sm font-semibold text-[#171814] outline-none transition focus:border-lime-300 focus:bg-white focus:ring-4 focus:ring-lime-200/35"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

type EditCheckboxProps = {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
};

function EditCheckbox({ label, checked, onChange }: EditCheckboxProps) {
  return (
    <label className="flex min-h-12 items-center gap-3 rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm font-semibold text-[#303329] shadow-[0_1px_10px_rgba(17,18,15,0.035)]">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 rounded border-black/20 accent-[#11130f]"
      />
      <span>{label}</span>
    </label>
  );
}

type EditTextareaProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
};

function EditTextarea({ label, value, onChange, rows = 3 }: EditTextareaProps) {
  return (
    <label className="block">
      <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#73796d]">
        {label}
      </span>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={rows}
        className="mt-2 w-full resize-none rounded-2xl border border-black/10 bg-black/[0.025] px-4 py-3 text-sm font-semibold text-[#171814] outline-none transition placeholder:text-[#9aa090] focus:border-lime-300 focus:bg-white focus:ring-4 focus:ring-lime-200/35"
      />
    </label>
  );
}

type TimelineEventProps = {
  event: MissionEventItem;
};

function TimelineEvent({ event }: TimelineEventProps) {
  const contextItems = [
    event.actorName ? `Acteur : ${event.actorName}` : null,
    event.driverName ? `Chauffeur : ${event.driverName}` : null,
    event.truckPlateNumber ? `Camion : ${event.truckPlateNumber}` : null,
    event.trailerPlateNumber
      ? `Remorque : ${event.trailerPlateNumber}`
      : null,
  ].filter(Boolean);

  // Une rotation de remorque est journalisée en NOTE_ADDED faute de type
  // dédié : afficher « Note ajoutée » masquerait l'action métier réelle.
  const rotation = describeTrailerRotationEvent(event.metadata);

  const message =
    rotation?.message ??
    event.message ??
    (event.fromStatus && event.toStatus
      ? `${event.fromStatus} -> ${event.toStatus}`
      : "Événement mission enregistré.");

  return (
    <article className="relative pl-5">
      <span className="absolute left-0 top-1.5 h-full w-px bg-black/10" />
      <span className="absolute left-[-4px] top-1.5 h-2.5 w-2.5 rounded-full border border-lime-300 bg-[#C8FF00] shadow-[0_0_14px_rgba(200,255,0,0.45)]" />

      <div className="rounded-2xl bg-black/[0.025] px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="rounded-full border border-black/10 bg-white px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#303329]">
            {rotation?.label ?? eventLabels[event.type]}
          </span>
          <time className="text-[11px] font-semibold text-[#8b9186]">
            {formatEventDate(event.createdAt)}
          </time>
        </div>

        <p className="mt-2 text-sm font-semibold leading-snug text-[#171814]">
          {message}
        </p>

        {contextItems.length > 0 ? (
          <p className="mt-2 text-[11px] font-medium leading-relaxed text-[#747a6f]">
            {contextItems.join(" · ")}
          </p>
        ) : null}
      </div>
    </article>
  );
}

function formatEventDate(value: string) {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatMissionDate(value: string | undefined) {
  if (!value) {
    return "Non renseignée";
  }

  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function formatPrice(amount: number | undefined, currency: string | undefined) {
  if (typeof amount !== "number") {
    return "Non renseigné";
  }

  return `${amount.toLocaleString("fr-FR")} ${currency ?? "EUR"}`;
}

function getJsonString(
  value: Record<string, unknown> | undefined,
  key: string,
) {
  const item = value?.[key];

  return typeof item === "string" && item.trim().length > 0
    ? item.trim()
    : undefined;
}

function getJsonNumber(
  value: Record<string, unknown> | undefined,
  key: string,
) {
  const item = value?.[key];
  return typeof item === "number" && Number.isFinite(item)
    ? item
    : undefined;
}

function getJsonBoolean(
  value: Record<string, unknown> | undefined,
  key: string,
) {
  const item = value?.[key];

  return typeof item === "boolean" ? item : undefined;
}

function toDatetimeLocalValue(value: string | undefined) {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const timezoneOffsetMs = date.getTimezoneOffset() * 60 * 1000;

  return new Date(date.getTime() - timezoneOffsetMs)
    .toISOString()
    .slice(0, 16);
}

function getRequirementBadges(requirements: Record<string, unknown> | undefined) {
  if (!requirements) {
    return [];
  }

  const operationalBadges: string[] = [];
  if (typeof requirements.requiredTrailerType === "string") {
    operationalBadges.push(`Remorque ${requirements.requiredTrailerType}`);
  }
  if (
    typeof requirements.requiredCapacityKg === "number" &&
    Number.isFinite(requirements.requiredCapacityKg)
  ) {
    operationalBadges.push(
      `${requirements.requiredCapacityKg.toLocaleString("fr-FR")} kg`,
    );
  }
  if (typeof requirements.requiredCouplingType === "string") {
    operationalBadges.push(`Attelage ${requirements.requiredCouplingType}`);
  }

  return operationalBadges;

  /* Les anciens critères restent conservés en base, mais ne sont plus présentés.
  const labels: Array<[string, string]> = [
    ["protectiveCorners", "Coins de protection"],
    ["cornerProtectorsRequired", "Coins de protection"],
    ["straps", "Sangles"],
    ["strapsRequired", "Sangles"],
    ["emptyTrailer", "Remorque vide"],
    ["emptyTrailerRequired", "Remorque vide"],
    ["safetyVest", "Veste sécurité"],
    ["safetyVestRequired", "Veste sécurité"],
    ["coveredTruckRequired", "Camion bâché"],
    ["appointmentRequired", "RDV"],
  ];

  return Array.from(new Set(labels
    .filter(([key]) => Boolean(requirements?.[key]))
    .map(([, label]) => label)));
  */
}

function hasTransportOrderData(mission: Mission) {
  return Boolean(
    mission.clientReference ||
      mission.pickupDate ||
      mission.deliveryDate ||
      mission.requiredTruckType ||
      typeof mission.priceAmount === "number" ||
      mission.paymentTerms ||
      mission.preAnnouncementRequired,
  );
}

function getMissionContactItems(contacts: Record<string, unknown> | undefined) {
  if (!contacts) {
    return [];
  }

  const items = [
    {
      label: "Contact chargement",
      value: [
        getJsonString(contacts, "pickupContactName"),
        getJsonString(contacts, "pickupPhone"),
        getJsonString(contacts, "pickupEmail"),
      ]
        .filter(Boolean)
        .join(" · "),
    },
    {
      label: "Contact livraison",
      value: [
        getJsonString(contacts, "deliveryContactName"),
        getJsonString(contacts, "deliveryPhone"),
        getJsonString(contacts, "deliveryEmail"),
      ]
        .filter(Boolean)
        .join(" · "),
    },
    {
      label: "Contact client",
      value: [
        getJsonString(contacts, "clientContactName"),
        getJsonString(contacts, "clientPhone"),
        getJsonString(contacts, "clientEmail"),
      ]
        .filter(Boolean)
        .join(" · "),
    },
    {
      label: "Horaires chargement",
      value: getJsonString(contacts, "pickupOpeningHours") ?? "",
    },
    {
      label: "Horaires livraison",
      value: getJsonString(contacts, "deliveryOpeningHours") ?? "",
    },
  ];

  return items.filter((item) => item.value.length > 0);
}

function MiniDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-white px-3 py-2">
      <dt className="text-[9px] font-semibold uppercase tracking-[0.16em] text-[#8b9186]">
        {label}
      </dt>
      <dd className="mt-1 text-[12px] font-semibold leading-snug text-[#252821]">
        {value}
      </dd>
    </div>
  );
}

type DetailItemProps = {
  label: string;
  value: string;
  className?: string;
};

function DetailItem({ label, value, className = "" }: DetailItemProps) {
  return (
    <div
      className={[
        "flex min-h-[96px] flex-col justify-between rounded-[24px] bg-black/[0.025] px-5 py-4 transition hover:bg-black/[0.04]",
        className,
      ].join(" ")}
    >
      <dt className="text-left text-[10px] font-semibold uppercase tracking-[0.18em] text-[#7a8074]">
        {label}
      </dt>

      <dd className="ml-0 text-left text-[15px] font-semibold leading-snug text-[#171814]">
        {value}
      </dd>
    </div>
  );
}
