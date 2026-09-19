"use client";

import type { FormEvent, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";

import type { ClientProfile } from "../../lib/dispatch/client-profiles";
import {
  normalizeClientProfile,
  normalizeCommaSeparatedList,
} from "../../lib/dispatch/client-profiles";

type ClientProfilesPanelProps = {
  isOpen: boolean;
  onClose: () => void;
  profiles: ClientProfile[];
  onProfilesChange: (profiles: ClientProfile[]) => void;
};

type ProfileFormState = {
  name: string;
  legalName: string;
  displayName: string;
  emailDomains: string;
  contactEmails: string;
  contactPhones: string;
  defaultPaymentTerms: string;
  defaultTruckType: string;
  defaultTrailerType: string;
  defaultPreAnnouncementRequired: boolean;
  strapsRequired: boolean;
  cornerProtectorsRequired: boolean;
  emptyTrailerRequired: boolean;
  safetyVestRequired: boolean;
  tailLift: boolean;
  adr: boolean;
  temperatureControlled: boolean;
  appointmentRequired: boolean;
  requirementsNotes: string;
  clientContactName: string;
  clientPhone: string;
  clientEmail: string;
  billingCompanyName: string;
  billingAddress: string;
  billingEmail: string;
  billingInstructions: string;
  operationalNotes: string;
  knownReferencePrefixes: string;
  subjectPatterns: string;
  pickupKeywords: string;
  deliveryKeywords: string;
  isActive: boolean;
};

const initialFormState: ProfileFormState = {
  name: "",
  legalName: "",
  displayName: "",
  emailDomains: "",
  contactEmails: "",
  contactPhones: "",
  defaultPaymentTerms: "",
  defaultTruckType: "",
  defaultTrailerType: "",
  defaultPreAnnouncementRequired: false,
  strapsRequired: false,
  cornerProtectorsRequired: false,
  emptyTrailerRequired: false,
  safetyVestRequired: false,
  tailLift: false,
  adr: false,
  temperatureControlled: false,
  appointmentRequired: false,
  requirementsNotes: "",
  clientContactName: "",
  clientPhone: "",
  clientEmail: "",
  billingCompanyName: "",
  billingAddress: "",
  billingEmail: "",
  billingInstructions: "",
  operationalNotes: "",
  knownReferencePrefixes: "",
  subjectPatterns: "",
  pickupKeywords: "",
  deliveryKeywords: "",
  isActive: true,
};

function getOptionalValue(value: string) {
  const trimmedValue = value.trim();
  return trimmedValue.length > 0 ? trimmedValue : undefined;
}

function getFormState(profile: ClientProfile): ProfileFormState {
  const requirements = profile.defaultRequirements ?? {};
  const contacts = profile.defaultContacts ?? {};
  const billingInfo = profile.billingInfo ?? {};
  const parserHints = profile.parserHints ?? {};

  return {
    name: profile.name,
    legalName: profile.legalName ?? "",
    displayName: profile.displayName ?? "",
    emailDomains: profile.emailDomains.join(", "),
    contactEmails: profile.contactEmails.join(", "),
    contactPhones: profile.contactPhones.join(", "),
    defaultPaymentTerms: profile.defaultPaymentTerms ?? "",
    defaultTruckType: profile.defaultTruckType ?? "",
    defaultTrailerType: profile.defaultTrailerType ?? "",
    defaultPreAnnouncementRequired: profile.defaultPreAnnouncementRequired,
    strapsRequired:
      requirements.strapsRequired ?? requirements.straps ?? false,
    cornerProtectorsRequired:
      requirements.cornerProtectorsRequired ??
      requirements.cornerProtectors ??
      false,
    emptyTrailerRequired: requirements.emptyTrailerRequired ?? false,
    safetyVestRequired:
      requirements.safetyVestRequired ?? requirements.safetyVest ?? false,
    tailLift: requirements.tailLift ?? false,
    adr: requirements.adr ?? false,
    temperatureControlled: requirements.temperatureControlled ?? false,
    appointmentRequired: requirements.appointmentRequired ?? false,
    requirementsNotes: requirements.notes ?? "",
    clientContactName: contacts.clientContactName ?? "",
    clientPhone: contacts.clientPhone ?? "",
    clientEmail: contacts.clientEmail ?? "",
    billingCompanyName:
      billingInfo.billingCompanyName ?? billingInfo.companyName ?? "",
    billingAddress: billingInfo.billingAddress ?? billingInfo.address ?? "",
    billingEmail: billingInfo.billingEmail ?? billingInfo.invoiceEmail ?? "",
    billingInstructions:
      billingInfo.billingInstructions ?? billingInfo.instructions ?? "",
    operationalNotes: profile.operationalNotes ?? "",
    knownReferencePrefixes:
      parserHints.knownReferencePrefixes?.join(", ") ?? "",
    subjectPatterns: parserHints.subjectPatterns?.join(", ") ?? "",
    pickupKeywords: parserHints.pickupKeywords?.join(", ") ?? "",
    deliveryKeywords: parserHints.deliveryKeywords?.join(", ") ?? "",
    isActive: profile.isActive,
  };
}

export function ClientProfilesPanel({
  isOpen,
  onClose,
  profiles,
  onProfilesChange,
}: ClientProfilesPanelProps) {
  const [items, setItems] = useState<ClientProfile[]>(profiles);
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(
    profiles[0]?.id ?? null,
  );
  const [formState, setFormState] = useState<ProfileFormState>(
    profiles[0] ? getFormState(profiles[0]) : initialFormState,
  );
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setItems(profiles);
    if (!isCreatingNew && !selectedProfileId && profiles[0]) {
      setSelectedProfileId(profiles[0].id);
      setFormState(getFormState(profiles[0]));
    }
  }, [isCreatingNew, profiles, selectedProfileId]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    void refreshProfiles();
  }, [isOpen]);

  const filteredProfiles = useMemo(() => {
    const query = search.trim().toLowerCase();

    if (!query) {
      return items;
    }

    return items.filter((profile) => {
      return [profile.name, profile.displayName, profile.legalName]
        .filter((value): value is string => typeof value === "string")
        .some((value) => value.toLowerCase().includes(query));
    });
  }, [items, search]);

  if (!isOpen) {
    return null;
  }

  function selectProfile(profile: ClientProfile) {
    setIsCreatingNew(false);
    setSelectedProfileId(profile.id);
    setFormState(getFormState(profile));
    setError(null);
  }

  function startCreate() {
    setIsCreatingNew(true);
    setSelectedProfileId(null);
    setFormState(initialFormState);
    setError(null);
  }

  function updateField<Field extends keyof ProfileFormState>(
    field: Field,
    value: ProfileFormState[Field],
  ) {
    setFormState((currentState) => ({
      ...currentState,
      [field]: value,
    }));
  }

  async function refreshProfiles(options?: {
    preferredSelectionId?: string | null;
    keepCreateMode?: boolean;
  }) {
    try {
      setIsLoading(true);
      setError(null);

      const response = await fetch("/api/dispatch/client-profiles");

      if (!response.ok) {
        throw new Error("Impossible de charger les profils clients.");
      }

      const data = (await response.json()) as {
        clientProfiles?: Record<string, unknown>[];
      };
      const nextProfiles = (data.clientProfiles ?? []).map((profile) =>
        normalizeClientProfile(profile),
      );

      setItems(nextProfiles);
      onProfilesChange(nextProfiles);

      const preferredSelectionId =
        options?.preferredSelectionId ?? selectedProfileId;
      const keepCreateMode = options?.keepCreateMode ?? isCreatingNew;

      if (preferredSelectionId) {
        const currentSelection = nextProfiles.find(
          (profile) => profile.id === preferredSelectionId,
        );

        if (currentSelection) {
          setSelectedProfileId(currentSelection.id);
          setIsCreatingNew(false);
          setFormState(getFormState(currentSelection));
          return;
        }
      }

      if (keepCreateMode) {
        setIsCreatingNew(true);
        setSelectedProfileId(null);
        return;
      }

      if (nextProfiles[0]) {
        const fallbackProfile = nextProfiles[0];
        setIsCreatingNew(false);
        setSelectedProfileId(fallbackProfile.id);
        setFormState(getFormState(fallbackProfile));
      } else {
        startCreate();
      }
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Impossible de charger les profils clients.",
      );
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!formState.name.trim()) {
      setError("Le nom client est obligatoire.");
      return;
    }

    try {
      setIsSaving(true);
      setError(null);

      const payload = {
        name: formState.name.trim(),
        legalName: getOptionalValue(formState.legalName),
        displayName: getOptionalValue(formState.displayName),
        emailDomains: normalizeCommaSeparatedList(formState.emailDomains),
        contactEmails: normalizeCommaSeparatedList(formState.contactEmails),
        contactPhones: normalizeCommaSeparatedList(formState.contactPhones),
        defaultPaymentTerms: getOptionalValue(formState.defaultPaymentTerms),
        defaultTruckType: getOptionalValue(formState.defaultTruckType),
        defaultTrailerType: getOptionalValue(formState.defaultTrailerType),
        defaultPreAnnouncementRequired:
          formState.defaultPreAnnouncementRequired,
        defaultRequirements: {
          straps: formState.strapsRequired,
          strapsRequired: formState.strapsRequired,
          cornerProtectors: formState.cornerProtectorsRequired,
          cornerProtectorsRequired: formState.cornerProtectorsRequired,
          emptyTrailerRequired: formState.emptyTrailerRequired,
          safetyVest: formState.safetyVestRequired,
          safetyVestRequired: formState.safetyVestRequired,
          tailLift: formState.tailLift,
          adr: formState.adr,
          temperatureControlled: formState.temperatureControlled,
          appointmentRequired: formState.appointmentRequired,
          notes: getOptionalValue(formState.requirementsNotes),
        },
        defaultContacts: {
          clientContactName: getOptionalValue(formState.clientContactName),
          clientPhone: getOptionalValue(formState.clientPhone),
          clientEmail: getOptionalValue(formState.clientEmail),
        },
        billingInfo: {
          billingCompanyName: getOptionalValue(formState.billingCompanyName),
          companyName: getOptionalValue(formState.billingCompanyName),
          billingAddress: getOptionalValue(formState.billingAddress),
          address: getOptionalValue(formState.billingAddress),
          billingEmail: getOptionalValue(formState.billingEmail),
          invoiceEmail: getOptionalValue(formState.billingEmail),
          billingInstructions: getOptionalValue(
            formState.billingInstructions,
          ),
          instructions: getOptionalValue(formState.billingInstructions),
        },
        operationalNotes: getOptionalValue(formState.operationalNotes),
        parserHints: {
          knownReferencePrefixes: normalizeCommaSeparatedList(
            formState.knownReferencePrefixes,
          ),
          subjectPatterns: normalizeCommaSeparatedList(
            formState.subjectPatterns,
          ),
          pickupKeywords: normalizeCommaSeparatedList(formState.pickupKeywords),
          deliveryKeywords: normalizeCommaSeparatedList(
            formState.deliveryKeywords,
          ),
        },
        isActive: formState.isActive,
      };

      const endpoint = selectedProfileId
        ? `/api/dispatch/client-profiles/${selectedProfileId}`
        : "/api/dispatch/client-profiles";
      const method = selectedProfileId ? "PUT" : "POST";
      const response = await fetch(endpoint, {
        method,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorBody = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(
          errorBody?.error ??
            "Impossible d'enregistrer le profil client.",
        );
      }

      const responseBody = (await response.json()) as {
        clientProfile?: Record<string, unknown>;
      };
      const savedProfile = responseBody.clientProfile
        ? normalizeClientProfile(responseBody.clientProfile)
        : null;

      if (savedProfile) {
        setSelectedProfileId(savedProfile.id);
        setIsCreatingNew(false);
      }

      await refreshProfiles({
        preferredSelectionId: savedProfile?.id ?? selectedProfileId,
        keepCreateMode: false,
      });
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Impossible d'enregistrer le profil client.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDeactivate() {
    if (!selectedProfileId) {
      return;
    }

    const confirmed = window.confirm(
      "Désactiver ce profil client ? Cette action est réversible uniquement en base.",
    );

    if (!confirmed) {
      return;
    }

    try {
      setIsSaving(true);
      setError(null);

      const response = await fetch(
        `/api/dispatch/client-profiles/${selectedProfileId}`,
        {
          method: "DELETE",
        },
      );

      if (!response.ok) {
        const errorBody = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(
          errorBody?.error ??
            "Impossible de désactiver le profil client.",
        );
      }

      await refreshProfiles({
        preferredSelectionId: null,
        keepCreateMode: false,
      });
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Impossible de désactiver le profil client.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <aside className="fixed inset-x-6 top-6 z-50 flex h-[calc(100vh-48px)] max-h-[900px] flex-col overflow-hidden rounded-[34px] border border-black/10 bg-[#f7f8f4] shadow-[0_28px_90px_rgba(17,18,15,0.18)]">
      <div className="flex items-start justify-between gap-6 border-b border-black/8 bg-white/90 px-6 py-5 backdrop-blur-xl">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#73796d]">
            RÉFÉRENTIEL CLIENT
          </p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight text-[#11120f]">
            Profils clients
          </h2>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void refreshProfiles()}
            className="rounded-full border border-black/10 bg-white px-4 py-2 text-xs font-semibold text-[#565c51] shadow-[0_1px_8px_rgba(17,18,15,0.05)] transition hover:border-lime-300 hover:text-[#405c08]"
          >
            Rafraîchir
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-black/10 bg-white px-4 py-2 text-xs font-semibold text-[#565c51] shadow-[0_1px_8px_rgba(17,18,15,0.05)] transition hover:border-lime-300 hover:text-[#405c08]"
          >
            Fermer
          </button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[320px_minmax(0,1fr)] gap-0">
        <div className="flex min-h-0 flex-col border-r border-black/8 bg-[#f1f3ed]">
          <div className="space-y-3 border-b border-black/8 px-5 py-4">
            <button
              type="button"
              onClick={startCreate}
              className="flex h-11 w-full items-center justify-center rounded-[18px] bg-[#11130f] px-4 text-sm font-semibold text-white shadow-[0_12px_30px_rgba(17,18,15,0.12)] transition hover:-translate-y-0.5"
            >
              Nouveau profil
            </button>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Rechercher un client"
              className="h-11 w-full rounded-[16px] border border-black/10 bg-white px-4 text-sm text-[#11120f] outline-none transition focus:border-lime-300 focus:ring-4 focus:ring-lime-200/35"
            />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
            <div className="space-y-2">
              {filteredProfiles.map((profile) => {
                const isSelected = profile.id === selectedProfileId;
                const requirementCount = Object.values(
                  profile.defaultRequirements ?? {},
                ).filter(Boolean).length;

                return (
                  <button
                    key={profile.id}
                    type="button"
                    onClick={() => selectProfile(profile)}
                    className={[
                      "w-full rounded-[20px] border px-4 py-4 text-left transition",
                      isSelected
                        ? "border-lime-300 bg-white shadow-[0_14px_34px_rgba(17,18,15,0.08)]"
                        : "border-black/6 bg-white/80 hover:border-black/12 hover:bg-white",
                    ].join(" ")}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-[#11120f]">
                          {profile.name}
                        </p>
                        {profile.emailDomains.length > 0 ? (
                          <p className="mt-1 truncate text-[11px] font-medium text-[#72776c]">
                            {profile.emailDomains.join(", ")}
                          </p>
                        ) : null}
                      </div>
                      <span className="rounded-full bg-black/[0.045] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#666b60]">
                        {profile.defaultPreAnnouncementRequired
                          ? "Pré-annonce"
                          : "Standard"}
                      </span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-semibold text-[#565b51]">
                      {profile.defaultTruckType ? (
                        <span className="rounded-full bg-[#f4f5f1] px-2.5 py-1">
                          {profile.defaultTruckType}
                        </span>
                      ) : null}
                      {profile.defaultTrailerType ? (
                        <span className="rounded-full bg-[#f4f5f1] px-2.5 py-1">
                          {profile.defaultTrailerType}
                        </span>
                      ) : null}
                      {requirementCount > 0 ? (
                        <span className="rounded-full bg-[#f4f5f1] px-2.5 py-1">
                          {requirementCount} contraintes
                        </span>
                      ) : null}
                    </div>
                  </button>
                );
              })}

              {!isLoading && filteredProfiles.length === 0 ? (
                <div className="rounded-[20px] border border-dashed border-black/10 bg-white/70 px-4 py-8 text-center text-sm font-medium text-[#72776c]">
                  Aucun profil actif pour le moment.
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="min-h-0 overflow-y-auto px-6 py-5">
          <div className="space-y-4">
            <FormSection title="Essentiel">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field
                  label="Nom client"
                  value={formState.name}
                  onChange={(value) => updateField("name", value)}
                  required
                />
                <Field
                  label="Nom légal"
                  value={formState.legalName}
                  onChange={(value) => updateField("legalName", value)}
                />
                <Field
                  label="Nom affiché"
                  value={formState.displayName}
                  onChange={(value) => updateField("displayName", value)}
                />
                <CheckboxField
                  label="Profil actif"
                  checked={formState.isActive}
                  onChange={(checked) => updateField("isActive", checked)}
                />
              </div>
            </FormSection>

            <FormSection title="Reconnaissance email">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field
                  label="Domaines email"
                  value={formState.emailDomains}
                  onChange={(value) => updateField("emailDomains", value)}
                  placeholder="fruytier.com, hydro.com"
                />
                <Field
                  label="Emails contacts"
                  value={formState.contactEmails}
                  onChange={(value) => updateField("contactEmails", value)}
                  placeholder="transport@client.com"
                />
                <Field
                  label="Téléphones contacts"
                  value={formState.contactPhones}
                  onChange={(value) => updateField("contactPhones", value)}
                  placeholder="+352 ..., +33 ..."
                />
              </div>
            </FormSection>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <FormSection title="Transport par défaut">
                <div className="space-y-3">
                  <Field
                    label="Type camion"
                    value={formState.defaultTruckType}
                    onChange={(value) => updateField("defaultTruckType", value)}
                    placeholder="Camion bâché · semi tautliner"
                  />
                  <Field
                    label="Type remorque"
                    value={formState.defaultTrailerType}
                    onChange={(value) =>
                      updateField("defaultTrailerType", value)
                    }
                    placeholder="Bâchée"
                  />
                  <Field
                    label="Conditions paiement"
                    value={formState.defaultPaymentTerms}
                    onChange={(value) =>
                      updateField("defaultPaymentTerms", value)
                    }
                    placeholder="30 jours fin de mois"
                  />
                  <CheckboxField
                    label="Pré-annonce obligatoire"
                    checked={formState.defaultPreAnnouncementRequired}
                    onChange={(checked) =>
                      updateField("defaultPreAnnouncementRequired", checked)
                    }
                  />
                </div>
              </FormSection>

              <FormSection title="Contraintes habituelles">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <CheckboxField
                    label="Sangles"
                    checked={formState.strapsRequired}
                    onChange={(checked) => updateField("strapsRequired", checked)}
                  />
                  <CheckboxField
                    label="Coins protection"
                    checked={formState.cornerProtectorsRequired}
                    onChange={(checked) =>
                      updateField("cornerProtectorsRequired", checked)
                    }
                  />
                  <CheckboxField
                    label="Remorque vide"
                    checked={formState.emptyTrailerRequired}
                    onChange={(checked) =>
                      updateField("emptyTrailerRequired", checked)
                    }
                  />
                  <CheckboxField
                    label="Veste sécurité"
                    checked={formState.safetyVestRequired}
                    onChange={(checked) =>
                      updateField("safetyVestRequired", checked)
                    }
                  />
                  <CheckboxField
                    label="Hayon"
                    checked={formState.tailLift}
                    onChange={(checked) => updateField("tailLift", checked)}
                  />
                  <CheckboxField
                    label="ADR"
                    checked={formState.adr}
                    onChange={(checked) => updateField("adr", checked)}
                  />
                  <CheckboxField
                    label="Température contrôlée"
                    checked={formState.temperatureControlled}
                    onChange={(checked) =>
                      updateField("temperatureControlled", checked)
                    }
                  />
                  <CheckboxField
                    label="RDV requis"
                    checked={formState.appointmentRequired}
                    onChange={(checked) =>
                      updateField("appointmentRequired", checked)
                    }
                  />
                </div>
                <div className="mt-3">
                  <Textarea
                    label="Notes contraintes"
                    value={formState.requirementsNotes}
                    onChange={(value) =>
                      updateField("requirementsNotes", value)
                    }
                  />
                </div>
              </FormSection>
            </div>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <FormSection title="Contacts">
                <div className="space-y-3">
                  <Field
                    label="Contact principal"
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
                    label="Adresse"
                    value={formState.billingAddress}
                    onChange={(value) => updateField("billingAddress", value)}
                  />
                  <Field
                    label="Email facturation"
                    value={formState.billingEmail}
                    onChange={(value) => updateField("billingEmail", value)}
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

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <FormSection title="Notes opérationnelles">
                <Textarea
                  label="Notes"
                  value={formState.operationalNotes}
                  onChange={(value) => updateField("operationalNotes", value)}
                />
              </FormSection>

              <FormSection title="Parser hints">
                <div className="space-y-3">
                  <Field
                    label="Préfixes référence"
                    value={formState.knownReferencePrefixes}
                    onChange={(value) =>
                      updateField("knownReferencePrefixes", value)
                    }
                    placeholder="LRB, HYD"
                  />
                  <Field
                    label="Patterns sujet"
                    value={formState.subjectPatterns}
                    onChange={(value) => updateField("subjectPatterns", value)}
                  />
                  <Field
                    label="Mots-clés chargement"
                    value={formState.pickupKeywords}
                    onChange={(value) => updateField("pickupKeywords", value)}
                  />
                  <Field
                    label="Mots-clés livraison"
                    value={formState.deliveryKeywords}
                    onChange={(value) =>
                      updateField("deliveryKeywords", value)
                    }
                  />
                </div>
              </FormSection>
            </div>
          </div>

          {error ? (
            <p className="mt-4 rounded-[18px] border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
              {error}
            </p>
          ) : null}

          <div className="sticky bottom-0 mt-6 flex items-center justify-between gap-3 border-t border-black/8 bg-[#f7f8f4]/96 px-1 pb-1 pt-4 backdrop-blur-xl">
            <button
              type="button"
              onClick={handleDeactivate}
              disabled={!selectedProfileId || isSaving}
              className="rounded-full border border-red-200 bg-white px-4 py-2 text-xs font-semibold text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Désactiver
            </button>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={startCreate}
                className="rounded-full border border-black/10 bg-white px-4 py-2 text-xs font-semibold text-[#565c51] transition hover:border-lime-300 hover:text-[#405c08]"
              >
                Réinitialiser
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="rounded-full bg-[#11130f] px-5 py-2.5 text-xs font-semibold text-white shadow-[0_12px_28px_rgba(17,18,15,0.15)] transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSaving ? "Enregistrement..." : selectedProfileId ? "Enregistrer" : "Créer le profil"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </aside>
  );
}

function FormSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-[24px] border border-black/8 bg-white px-5 py-5 shadow-[0_12px_30px_rgba(17,18,15,0.04)]">
      <h3 className="text-sm font-semibold text-[#11120f]">{title}</h3>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  required = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#73796d]">
        {label}
      </span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        required={required}
        className="mt-2 h-12 w-full rounded-[18px] border border-black/10 bg-[#fcfcfa] px-4 text-sm text-[#11120f] outline-none transition focus:border-lime-300 focus:ring-4 focus:ring-lime-200/35"
      />
    </label>
  );
}

function Textarea({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#73796d]">
        {label}
      </span>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={4}
        className="mt-2 w-full rounded-[18px] border border-black/10 bg-[#fcfcfa] px-4 py-3 text-sm text-[#11120f] outline-none transition focus:border-lime-300 focus:ring-4 focus:ring-lime-200/35"
      />
    </label>
  );
}

function CheckboxField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex h-12 items-center justify-between rounded-[18px] border border-black/10 bg-[#fcfcfa] px-4">
      <span className="text-sm font-medium text-[#23251f]">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 accent-[#11130f]"
      />
    </label>
  );
}
