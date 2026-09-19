"use client";

import type { FormEvent, InputHTMLAttributes, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";

import { AddressAutocomplete } from "./AddressAutocomplete";
import type { AddressPlace } from "./AddressAutocomplete";
import type { ClientProfile } from "../../lib/dispatch/client-profiles";
import {
  buildMissionProfileDefaults,
  findMatchingClientProfile,
} from "../../lib/dispatch/client-profiles";
import type {
  ImportMissionCreationResult,
  MissionSourceEmailPayload,
} from "../../lib/mail/types";
import type { MissionStatus } from "../../lib/dispatch/mock-data";
import {
  missionCouplingTypeOptions,
  missionTrailerTypeOptions,
} from "../../lib/dispatch/mission-form-options";

export type CreateMissionFormData = {
  reference: string;
  title?: string;
  clientName: string;
  pickupCity: string;
  deliveryCity: string;
  pickupAddress?: string;
  deliveryAddress?: string;
  pickupPlaceId?: string;
  deliveryPlaceId?: string;
  pickupLat?: number;
  pickupLng?: number;
  deliveryLat?: number;
  deliveryLng?: number;
  estimatedKm?: number;
  clientReference?: string;
  cmrNumber?: string;
  deliveryNoteNumber?: string;
  pickupDate?: string;
  deliveryDate?: string;
  requiredTruckType?: string | null;
  requiredTrailerType?: string;
  priceAmount?: number;
  priceCurrency?: string;
  paymentTerms?: string;
  preAnnouncementRequired?: boolean;
  preAnnouncementSent?: boolean;
  preAnnouncementSentAt?: string;
  requirements?: Record<string, unknown>;
  contacts?: Record<string, unknown>;
  billingInfo?: Record<string, unknown>;
  status?: MissionStatus;
  routeDistanceMeters?: number;
  routeDurationSeconds?: number;
  sourceEmailId?: string;
  sourceEmailFrom?: string;
  sourceEmailSubject?: string;
  sourceEmail?: MissionSourceEmailPayload;
  importMetadata?: {
    parserId?: string;
    parserChain?: string[];
    editedFields?: Record<string, unknown>;
  };
  notes?: string;
};

type CreateMissionPanelProps = {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (
    data: CreateMissionFormData,
  ) => Promise<ImportMissionCreationResult | void>;
  clientProfiles?: ClientProfile[];
};

type FormState = {
  reference: string;
  title: string;
  clientName: string;
  clientReference: string;
  cmrNumber: string;
  deliveryNoteNumber: string;
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

const initialFormState: FormState = {
  reference: "",
  title: "",
  clientName: "",
  clientReference: "",
  cmrNumber: "",
  deliveryNoteNumber: "",
  status: "pending",
  pickupCity: "",
  deliveryCity: "",
  pickupAddress: "",
  deliveryAddress: "",
  pickupPlaceId: "",
  deliveryPlaceId: "",
  pickupLat: null,
  pickupLng: null,
  deliveryLat: null,
  deliveryLng: null,
  estimatedKm: "",
  pickupDate: "",
  deliveryDate: "",
  requiredTruckType: "",
  requiredCapacityKg: "",
  requiredCargoType: "",
  requiredCouplingType: "",
  priceAmount: "",
  priceCurrency: "EUR",
  paymentTerms: "",
  preAnnouncementRequired: false,
  preAnnouncementSent: false,
  preAnnouncementSentAt: "",
  strapsRequired: false,
  cornerProtectorsRequired: false,
  emptyTrailerRequired: false,
  safetyVestRequired: false,
  coveredTruckRequired: false,
  appointmentRequired: false,
  loadingRequirementsText: "",
  unloadingRequirementsText: "",
  pickupContactName: "",
  pickupPhone: "",
  pickupEmail: "",
  pickupOpeningHours: "",
  pickupRemarks: "",
  deliveryContactName: "",
  deliveryPhone: "",
  deliveryEmail: "",
  deliveryOpeningHours: "",
  deliveryRemarks: "",
  clientContactName: "",
  clientPhone: "",
  clientEmail: "",
  billingCompanyName: "",
  billingAddress: "",
  billingEmail: "",
  billingInstructions: "",
  notes: "",
};

const missionStatuses: Array<{ value: MissionStatus; label: string }> = [
  { value: "pending", label: "À planifier" },
  { value: "assigned", label: "Assignée" },
  { value: "in_progress", label: "En cours" },
  { value: "done", label: "Terminée" },
  { value: "issue", label: "Problème" },
  { value: "cancelled", label: "Annulée" },
];

export function CreateMissionPanel({
  isOpen,
  onClose,
  onCreate,
  clientProfiles = [],
}: CreateMissionPanelProps) {
  const [formState, setFormState] = useState<FormState>(initialFormState);
  const [selectedClientProfileId, setSelectedClientProfileId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const selectedClientProfile = useMemo(
    () =>
      clientProfiles.find((profile) => profile.id === selectedClientProfileId) ??
      null,
    [clientProfiles, selectedClientProfileId],
  );

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const matchingProfile = findMatchingClientProfile(
      clientProfiles,
      formState.clientName,
    );
    setSelectedClientProfileId(matchingProfile?.id ?? "");
  }, [clientProfiles, formState.clientName, isOpen]);

  if (!isOpen) {
    return null;
  }

  const isValid =
    formState.reference.trim().length > 0 &&
    formState.clientName.trim().length > 0 &&
    formState.pickupCity.trim().length > 0 &&
    formState.deliveryCity.trim().length > 0;

  function updateField<Field extends keyof FormState>(
    field: Field,
    value: FormState[Field],
  ) {
    setFormState((currentFormState) => ({
      ...currentFormState,
      [field]: value,
    }));
  }

  function applyClientProfile(profile: ClientProfile, force = false) {
    const defaults = buildMissionProfileDefaults(profile);

    setFormState((currentFormState) => {
      const nextNotes = [currentFormState.notes.trim(), defaults.notes?.trim()]
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
        ...currentFormState,
        clientName: getNextValue(currentFormState.clientName, defaults.clientName ?? ""),
        paymentTerms: getNextValue(
          currentFormState.paymentTerms,
          defaults.paymentTerms ?? "",
        ),
        requiredTruckType: getNextValue(
          currentFormState.requiredTruckType,
          defaults.requiredTruckType ?? "",
        ),
        preAnnouncementRequired:
          force || !currentFormState.preAnnouncementRequired
            ? defaults.preAnnouncementRequired ??
              currentFormState.preAnnouncementRequired
            : currentFormState.preAnnouncementRequired,
        strapsRequired:
          force || !currentFormState.strapsRequired
            ? defaults.strapsRequired ?? currentFormState.strapsRequired
            : currentFormState.strapsRequired,
        cornerProtectorsRequired:
          force || !currentFormState.cornerProtectorsRequired
            ? defaults.cornerProtectorsRequired ??
              currentFormState.cornerProtectorsRequired
            : currentFormState.cornerProtectorsRequired,
        emptyTrailerRequired:
          force || !currentFormState.emptyTrailerRequired
            ? defaults.emptyTrailerRequired ??
              currentFormState.emptyTrailerRequired
            : currentFormState.emptyTrailerRequired,
        safetyVestRequired:
          force || !currentFormState.safetyVestRequired
            ? defaults.safetyVestRequired ??
              currentFormState.safetyVestRequired
            : currentFormState.safetyVestRequired,
        coveredTruckRequired:
          force || !currentFormState.coveredTruckRequired
            ? defaults.coveredTruckRequired ??
              currentFormState.coveredTruckRequired
            : currentFormState.coveredTruckRequired,
        appointmentRequired:
          force || !currentFormState.appointmentRequired
            ? defaults.appointmentRequired ??
              currentFormState.appointmentRequired
            : currentFormState.appointmentRequired,
        loadingRequirementsText: getNextValue(
          currentFormState.loadingRequirementsText,
          defaults.loadingRequirementsText ?? "",
        ),
        clientContactName: getNextValue(
          currentFormState.clientContactName,
          defaults.clientContactName ?? "",
        ),
        clientPhone: getNextValue(
          currentFormState.clientPhone,
          defaults.clientPhone ?? "",
        ),
        clientEmail: getNextValue(
          currentFormState.clientEmail,
          defaults.clientEmail ?? "",
        ),
        billingCompanyName: getNextValue(
          currentFormState.billingCompanyName,
          defaults.billingCompanyName ?? "",
        ),
        billingAddress: getNextValue(
          currentFormState.billingAddress,
          defaults.billingAddress ?? "",
        ),
        billingEmail: getNextValue(
          currentFormState.billingEmail,
          defaults.billingEmail ?? "",
        ),
        billingInstructions: getNextValue(
          currentFormState.billingInstructions,
          defaults.billingInstructions ?? "",
        ),
        notes:
          force && defaults.notes
            ? nextNotes
            : currentFormState.notes.trim().length === 0
            ? defaults.notes ?? currentFormState.notes
            : currentFormState.notes,
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
      requiredTrailerType:
        getOptionalValue(formState.requiredTruckType)?.toUpperCase() ?? null,
      requiredCapacityKg:
        getOptionalNumber(formState.requiredCapacityKg) ?? null,
      requiredCouplingType:
        getOptionalValue(formState.requiredCouplingType)?.toUpperCase() ?? null,
    };
  }

  function buildContacts(): Record<string, unknown> {
    return {
      pickupContactName: getOptionalValue(formState.pickupContactName),
      pickupPhone: getOptionalValue(formState.pickupPhone),
      pickupEmail: getOptionalValue(formState.pickupEmail),
      pickupOpeningHours: getOptionalValue(formState.pickupOpeningHours),
      pickupRemarks: getOptionalValue(formState.pickupRemarks),
      deliveryContactName: getOptionalValue(formState.deliveryContactName),
      deliveryPhone: getOptionalValue(formState.deliveryPhone),
      deliveryEmail: getOptionalValue(formState.deliveryEmail),
      deliveryOpeningHours: getOptionalValue(formState.deliveryOpeningHours),
      deliveryRemarks: getOptionalValue(formState.deliveryRemarks),
      clientContactName: getOptionalValue(formState.clientContactName),
      clientPhone: getOptionalValue(formState.clientPhone),
      clientEmail: getOptionalValue(formState.clientEmail),
    };
  }

  function buildBillingInfo(): Record<string, unknown> {
    const billingEmail = getOptionalValue(formState.billingEmail);
    const billingInstructions = getOptionalValue(formState.billingInstructions);

    return {
      billingCompanyName: getOptionalValue(formState.billingCompanyName),
      companyName: getOptionalValue(formState.billingCompanyName),
      billingAddress: getOptionalValue(formState.billingAddress),
      address: getOptionalValue(formState.billingAddress),
      billingEmail,
      invoiceEmail: billingEmail,
      billingInstructions,
      instructions: billingInstructions,
      paymentTerms: getOptionalValue(formState.paymentTerms),
    };
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!isValid) {
      setError("Référence, client, départ et livraison sont obligatoires.");
      return;
    }

    const estimatedKm = getOptionalNumber(formState.estimatedKm);
    const priceAmount = getOptionalNumber(formState.priceAmount);
    const requiredCapacityKg = getOptionalNumber(formState.requiredCapacityKg);

    if (estimatedKm === null || (estimatedKm ?? 0) < 0) {
      setError("La distance estimée doit être un nombre positif.");
      return;
    }

    if (priceAmount === null || (priceAmount ?? 0) < 0) {
      setError("Le prix doit être un nombre positif.");
      return;
    }
    if (
      requiredCapacityKg === null ||
      (typeof requiredCapacityKg === "number" && requiredCapacityKg <= 0)
    ) {
      setError("La capacité remorque doit être un nombre positif.");
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);

      await onCreate({
        reference: formState.reference.trim(),
        title: getOptionalValue(formState.title),
        clientName: formState.clientName.trim(),
        clientReference: getOptionalValue(formState.clientReference),
        cmrNumber: getOptionalValue(formState.cmrNumber),
        deliveryNoteNumber: getOptionalValue(formState.deliveryNoteNumber),
        status: formState.status,
        pickupCity: formState.pickupCity.trim(),
        deliveryCity: formState.deliveryCity.trim(),
        pickupAddress: getOptionalValue(formState.pickupAddress),
        deliveryAddress: getOptionalValue(formState.deliveryAddress),
        pickupPlaceId: getOptionalValue(formState.pickupPlaceId),
        deliveryPlaceId: getOptionalValue(formState.deliveryPlaceId),
        pickupLat: formState.pickupLat ?? undefined,
        pickupLng: formState.pickupLng ?? undefined,
        deliveryLat: formState.deliveryLat ?? undefined,
        deliveryLng: formState.deliveryLng ?? undefined,
        estimatedKm:
          typeof estimatedKm === "number" ? Math.round(estimatedKm) : undefined,
        pickupDate: getOptionalValue(formState.pickupDate),
        deliveryDate: getOptionalValue(formState.deliveryDate),
        // Colonne historique conservée en base mais non alimentée : le besoin
        // de transport appartient désormais explicitement à la remorque.
        requiredTruckType: null,
        priceAmount:
          typeof priceAmount === "number" ? priceAmount : undefined,
        priceCurrency: getOptionalValue(formState.priceCurrency),
        paymentTerms: getOptionalValue(formState.paymentTerms),
        preAnnouncementRequired: formState.preAnnouncementRequired,
        preAnnouncementSent: formState.preAnnouncementSent,
        preAnnouncementSentAt: getOptionalValue(
          formState.preAnnouncementSentAt,
        ),
        requirements: buildRequirements(),
        contacts: buildContacts(),
        billingInfo: buildBillingInfo(),
        notes: getOptionalValue(formState.notes),
      });

      setFormState(initialFormState);
      setSelectedClientProfileId("");
      onClose();
    } catch (createError) {
      console.error("Unable to create mission", createError);
      setError(
        createError instanceof Error
          ? createError.message
          : "Impossible de créer la mission.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  function handlePickupAddressChange(value: string) {
    setFormState((currentFormState) => ({
      ...currentFormState,
      pickupAddress: value,
      pickupPlaceId: "",
      pickupLat: null,
      pickupLng: null,
    }));
  }

  function handleDeliveryAddressChange(value: string) {
    setFormState((currentFormState) => ({
      ...currentFormState,
      deliveryAddress: value,
      deliveryPlaceId: "",
      deliveryLat: null,
      deliveryLng: null,
    }));
  }

  function handlePickupPlaceSelect(place: AddressPlace) {
    setFormState((currentFormState) => ({
      ...currentFormState,
      pickupAddress: place.label,
      pickupPlaceId: place.placeId,
      pickupLat: place.lat ?? null,
      pickupLng: place.lng ?? null,
    }));
  }

  function handleDeliveryPlaceSelect(place: AddressPlace) {
    setFormState((currentFormState) => ({
      ...currentFormState,
      deliveryAddress: place.label,
      deliveryPlaceId: place.placeId,
      deliveryLat: place.lat ?? null,
      deliveryLng: place.lng ?? null,
    }));
  }

  return (
    <aside className="fixed right-4 top-4 z-50 flex h-[calc(100vh-32px)] w-[800px] max-w-[98vw] flex-col rounded-[32px] border border-black/10 bg-white p-6 shadow-[0_24px_80px_rgba(17,18,15,0.18)] backdrop-blur-xl">
      <div className="flex items-start justify-between gap-6 border-b border-black/10 pb-5">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#73796d]">
            NOUVELLE MISSION
          </p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight text-[#11120f]">
            Création manuelle
          </h2>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="rounded-full border border-black/10 bg-white px-4 py-2 text-xs font-semibold text-[#565c51] shadow-[0_1px_8px_rgba(17,18,15,0.05)] transition hover:border-lime-300 hover:text-[#405c08]"
        >
          Fermer
        </button>
      </div>

      <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
        <div className="flex-1 overflow-y-auto py-5">
          <div className="space-y-4">
            <FormSection title="Informations mission">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <SelectField
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
                <Field
                  label="Référence client"
                  value={formState.clientReference}
                  onChange={(value) => updateField("clientReference", value)}
                  placeholder="EXP-24056"
                />
                <Field
                  label="Numéro CMR"
                  value={formState.cmrNumber}
                  onChange={(value) => updateField("cmrNumber", value)}
                  placeholder="CMR-..."
                />
                <Field
                  label="Bon de livraison"
                  value={formState.deliveryNoteNumber}
                  onChange={(value) => updateField("deliveryNoteNumber", value)}
                  placeholder="BL-..."
                />
                <Field
                  label="Référence interne"
                  value={formState.reference}
                  onChange={(value) => updateField("reference", value)}
                  placeholder="NTX-2060"
                  required
                />
                <Field
                  label="Client"
                  value={formState.clientName}
                  onChange={(value) => updateField("clientName", value)}
                  placeholder="Translog Europe"
                  required
                />
                <Field
                  label="Libellé court"
                  value={formState.title}
                  onChange={(value) => updateField("title", value)}
                  placeholder="Luxembourg → Paris"
                />
                <SelectField
                  label="Statut"
                  value={formState.status}
                  onChange={(value) =>
                    updateField("status", value as MissionStatus)
                  }
                  options={missionStatuses}
                />
                <Field
                  label="Kilomètres estimés"
                  value={formState.estimatedKm}
                  onChange={(value) => updateField("estimatedKm", value)}
                  placeholder="320"
                  inputMode="numeric"
                />
              </div>
            </FormSection>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <FormSection title="Départ">
                <div className="space-y-3">
                  <Field
                    label="Ville de départ"
                    value={formState.pickupCity}
                    onChange={(value) => updateField("pickupCity", value)}
                    placeholder="Luxembourg"
                    required
                  />
                  <AddressAutocomplete
                    label="Adresse de départ"
                    value={formState.pickupAddress}
                    placeId={formState.pickupPlaceId}
                    onChange={handlePickupAddressChange}
                    onSelect={handlePickupPlaceSelect}
                    placeholder="Optionnel"
                  />
                  <Field
                    label="Date chargement"
                    value={formState.pickupDate}
                    onChange={(value) => updateField("pickupDate", value)}
                    type="datetime-local"
                  />
                  <Field
                    label="Contact chargement"
                    value={formState.pickupContactName}
                    onChange={(value) =>
                      updateField("pickupContactName", value)
                    }
                    placeholder="Nom contact"
                  />
                  <Field
                    label="Téléphone chargement"
                    value={formState.pickupPhone}
                    onChange={(value) => updateField("pickupPhone", value)}
                    placeholder="+352 ..."
                  />
                  <Field
                    label="Email chargement"
                    value={formState.pickupEmail}
                    onChange={(value) => updateField("pickupEmail", value)}
                    placeholder="pickup@client.com"
                  />
                  <Field
                    label="Horaires chargement"
                    value={formState.pickupOpeningHours}
                    onChange={(value) =>
                      updateField("pickupOpeningHours", value)
                    }
                    placeholder="08:00 - 16:00"
                  />
                  <Textarea
                    label="Remarques chargement"
                    value={formState.pickupRemarks}
                    onChange={(value) => updateField("pickupRemarks", value)}
                  />
                </div>
              </FormSection>

              <FormSection title="Livraison">
                <div className="space-y-3">
                  <Field
                    label="Ville de livraison"
                    value={formState.deliveryCity}
                    onChange={(value) => updateField("deliveryCity", value)}
                    placeholder="Paris"
                    required
                  />
                  <AddressAutocomplete
                    label="Adresse de livraison"
                    value={formState.deliveryAddress}
                    placeId={formState.deliveryPlaceId}
                    onChange={handleDeliveryAddressChange}
                    onSelect={handleDeliveryPlaceSelect}
                    placeholder="Optionnel"
                  />
                  <Field
                    label="Date livraison"
                    value={formState.deliveryDate}
                    onChange={(value) => updateField("deliveryDate", value)}
                    type="datetime-local"
                  />
                  <Field
                    label="Contact livraison"
                    value={formState.deliveryContactName}
                    onChange={(value) =>
                      updateField("deliveryContactName", value)
                    }
                    placeholder="Nom contact"
                  />
                  <Field
                    label="Téléphone livraison"
                    value={formState.deliveryPhone}
                    onChange={(value) => updateField("deliveryPhone", value)}
                    placeholder="+33 ..."
                  />
                  <Field
                    label="Email livraison"
                    value={formState.deliveryEmail}
                    onChange={(value) => updateField("deliveryEmail", value)}
                    placeholder="delivery@client.com"
                  />
                  <Field
                    label="Horaires livraison"
                    value={formState.deliveryOpeningHours}
                    onChange={(value) =>
                      updateField("deliveryOpeningHours", value)
                    }
                    placeholder="Sur RDV"
                  />
                  <Textarea
                    label="Remarques livraison"
                    value={formState.deliveryRemarks}
                    onChange={(value) =>
                      updateField("deliveryRemarks", value)
                    }
                  />
                </div>
              </FormSection>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <FormSection title="Transport & Prix">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <SelectField
                    label="Type de remorque requis"
                    value={formState.requiredTruckType}
                    onChange={(value) =>
                      updateField("requiredTruckType", value)
                    }
                    options={missionTrailerTypeOptions}
                  />
                  <Field
                    label="Capacité remorque minimale (kg)"
                    value={formState.requiredCapacityKg}
                    onChange={(value) =>
                      updateField("requiredCapacityKg", value)
                    }
                    placeholder="24000"
                    inputMode="numeric"
                  />
                  <SelectField
                    label="Attelage requis"
                    value={formState.requiredCouplingType}
                    onChange={(value) =>
                      updateField("requiredCouplingType", value)
                    }
                    options={missionCouplingTypeOptions}
                  />
                  <Field
                    label="Prix"
                    value={formState.priceAmount}
                    onChange={(value) => updateField("priceAmount", value)}
                    placeholder="867.00"
                    inputMode="decimal"
                  />
                  <Field
                    label="Devise"
                    value={formState.priceCurrency}
                    onChange={(value) => updateField("priceCurrency", value)}
                    placeholder="EUR"
                  />
                  <Field
                    label="Paiement"
                    value={formState.paymentTerms}
                    onChange={(value) => updateField("paymentTerms", value)}
                    placeholder="30 jours fin de mois"
                  />
                </div>
              </FormSection>

              <FormSection title="Pré-annonce">
                <div className="space-y-3">
                  <CheckboxField
                    label="Pré-annonce obligatoire"
                    checked={formState.preAnnouncementRequired}
                    onChange={(checked) =>
                      updateField("preAnnouncementRequired", checked)
                    }
                  />
                  <CheckboxField
                    label="Pré-annonce envoyée"
                    checked={formState.preAnnouncementSent}
                    onChange={(checked) =>
                      updateField("preAnnouncementSent", checked)
                    }
                  />
                  <Field
                    label="Date envoi pré-annonce"
                    value={formState.preAnnouncementSentAt}
                    onChange={(value) =>
                      updateField("preAnnouncementSentAt", value)
                    }
                    type="datetime-local"
                  />
                </div>
              </FormSection>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <FormSection title="Contact client">
                <div className="space-y-3">
                  <Field
                    label="Nom contact"
                    value={formState.clientContactName}
                    onChange={(value) =>
                      updateField("clientContactName", value)
                    }
                  />
                  <Field
                    label="Téléphone"
                    value={formState.clientPhone}
                    onChange={(value) => updateField("clientPhone", value)}
                  />
                  <Field
                    label="Email"
                    value={formState.clientEmail}
                    onChange={(value) => updateField("clientEmail", value)}
                  />
                </div>
              </FormSection>

              <FormSection title="Facturation">
                <div className="space-y-3">
                  <Field
                    label="Société"
                    value={formState.billingCompanyName}
                    onChange={(value) =>
                      updateField("billingCompanyName", value)
                    }
                  />
                  <Field
                    label="Email facture"
                    value={formState.billingEmail}
                    onChange={(value) => updateField("billingEmail", value)}
                  />
                  <Textarea
                    label="Adresse facturation"
                    value={formState.billingAddress}
                    onChange={(value) =>
                      updateField("billingAddress", value)
                    }
                  />
                  <Textarea
                    label="Instructions"
                    value={formState.billingInstructions}
                    onChange={(value) =>
                      updateField("billingInstructions", value)
                    }
                  />
                </div>
              </FormSection>
            </div>

            <FormSection title="Notes">
              <Textarea
                label="Notes"
                value={formState.notes}
                onChange={(value) => updateField("notes", value)}
                rows={4}
              />
            </FormSection>
          </div>

          {error ? (
            <p className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-semibold text-red-700">
              {error}
            </p>
          ) : null}
        </div>

        <div className="border-t border-black/10 pt-4">
          <button
            type="submit"
            disabled={!isValid || isSubmitting}
            className="w-full rounded-2xl bg-[#11130f] px-4 py-3 text-sm font-semibold text-white shadow-[0_12px_32px_rgba(17,18,15,0.15)] transition hover:bg-[#C8FF00] hover:text-black disabled:cursor-not-allowed disabled:bg-black/20 disabled:text-white"
          >
            {isSubmitting ? "Création..." : "Créer la mission"}
          </button>
        </div>
      </form>
    </aside>
  );
}

type FieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  inputMode?: InputHTMLAttributes<HTMLInputElement>["inputMode"];
  type?: InputHTMLAttributes<HTMLInputElement>["type"];
};

type FormSectionProps = {
  title: string;
  children: ReactNode;
};

function FormSection({ title, children }: FormSectionProps) {
  return (
    <section className="rounded-[26px] bg-black/[0.018] p-4">
      <h3 className="mb-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#73796d]">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  required = false,
  inputMode,
  type = "text",
}: FieldProps) {
  return (
    <label>
      <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#73796d]">
        {label}
        {required ? " *" : ""}
      </span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        inputMode={inputMode}
        type={type}
        className="mt-2 h-12 w-full rounded-2xl border border-black/10 bg-black/[0.025] px-4 text-sm font-semibold text-[#171814] outline-none transition placeholder:text-[#9aa090] focus:border-lime-300 focus:bg-white focus:ring-4 focus:ring-lime-200/35"
      />
    </label>
  );
}

type SelectFieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
};

function SelectField({ label, value, onChange, options }: SelectFieldProps) {
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

type CheckboxFieldProps = {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
};

function CheckboxField({ label, checked, onChange }: CheckboxFieldProps) {
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

type TextareaProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
};

function Textarea({ label, value, onChange, rows = 3 }: TextareaProps) {
  return (
    <label className="block">
      <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#73796d]">
        {label}
      </span>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Optionnel"
        rows={rows}
        className="mt-2 w-full resize-none rounded-2xl border border-black/10 bg-black/[0.025] px-4 py-3 text-sm font-semibold text-[#171814] outline-none transition placeholder:text-[#9aa090] focus:border-lime-300 focus:bg-white focus:ring-4 focus:ring-lime-200/35"
      />
    </label>
  );
}
