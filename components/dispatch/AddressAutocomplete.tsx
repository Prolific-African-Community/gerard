"use client";

import { useEffect, useRef, useState } from "react";

export type AddressPlace = {
  placeId: string;
  label: string;
  mainText?: string;
  secondaryText?: string;
  lat?: number;
  lng?: number;
};

type PlacesSearchResponse = {
  suggestions: AddressPlace[];
};

type PlaceDetailsResponse = {
  placeId: string;
  address: string;
  lat: number;
  lng: number;
};

type AddressAutocompleteProps = {
  label: string;
  value: string;
  placeId?: string;
  placeholder?: string;
  onChange: (value: string) => void;
  onSelect: (place: AddressPlace) => void;
};

export function AddressAutocomplete({
  label,
  value,
  placeId,
  placeholder,
  onChange,
  onSelect,
}: AddressAutocompleteProps) {
  const [suggestions, setSuggestions] = useState<AddressPlace[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [resolvingPlaceId, setResolvingPlaceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLLabelElement | null>(null);

  useEffect(() => {
    if (value.trim().length < 3) {
      setSuggestions([]);
      setIsLoading(false);
      setError(null);
      return;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(async () => {
      try {
        setIsLoading(true);
        setError(null);

        const response = await fetch(
          `/api/dispatch/places-search?query=${encodeURIComponent(value)}`,
          {
            signal: controller.signal,
          },
        );

        if (!response.ok) {
          throw new Error(`Places search returned ${response.status}`);
        }

        const data = (await response.json()) as PlacesSearchResponse;
        setSuggestions(data.suggestions);
        setIsOpen(true);
      } catch (searchError) {
        if (
          searchError instanceof DOMException &&
          searchError.name === "AbortError"
        ) {
          return;
        }

        console.error("Unable to search places", searchError);
        setSuggestions([]);
        setError("Recherche indisponible");
        setIsOpen(true);
      } finally {
        setIsLoading(false);
      }
    }, 280);

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [value]);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);

    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  async function handleSelectSuggestion(suggestion: AddressPlace) {
    setIsOpen(false);

    try {
      setResolvingPlaceId(suggestion.placeId);

      const response = await fetch(
        `/api/dispatch/google-place-details?placeId=${encodeURIComponent(
          suggestion.placeId,
        )}`,
      );

      if (!response.ok) {
        throw new Error(`Place details returned ${response.status}`);
      }

      const details = (await response.json()) as PlaceDetailsResponse;

      onSelect({
        ...suggestion,
        placeId: details.placeId,
        label: details.address,
        lat: details.lat,
        lng: details.lng,
      });
    } catch (detailsError) {
      console.error("Unable to load place details", detailsError);
      onSelect(suggestion);
    } finally {
      setResolvingPlaceId(null);
    }
  }

  return (
    <label ref={containerRef} className="relative block">
      <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#73796d]">
        {label}
      </span>
      <input
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          setIsOpen(true);
        }}
        onFocus={() => setIsOpen(true)}
        placeholder={placeholder}
        className="mt-2 h-12 w-full rounded-2xl border border-black/10 bg-black/[0.025] px-4 pr-10 text-sm font-semibold text-[#171814] outline-none transition placeholder:text-[#9aa090] focus:border-lime-300 focus:bg-white focus:ring-4 focus:ring-lime-200/35"
      />

      {placeId ? (
        <span className="absolute right-3 top-[38px] rounded-full bg-lime-100 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-[#49630b]">
          Validée
        </span>
      ) : null}

      {isOpen && value.trim().length >= 3 ? (
        <div className="absolute left-0 right-0 top-[76px] z-[70] overflow-hidden rounded-2xl border border-black/10 bg-white shadow-[0_18px_50px_rgba(17,18,15,0.14)]">
          {isLoading || resolvingPlaceId ? (
            <div className="px-4 py-3 text-xs font-semibold text-[#747a6f]">
              {resolvingPlaceId ? "Validation de l'adresse..." : "Recherche..."}
            </div>
          ) : null}

          {!isLoading && !resolvingPlaceId && error ? (
            <div className="px-4 py-3 text-xs font-semibold text-red-700">
              {error}
            </div>
          ) : null}

          {!isLoading && !resolvingPlaceId && !error && suggestions.length === 0 ? (
            <div className="px-4 py-3 text-xs font-semibold text-[#747a6f]">
              Aucune adresse trouvée
            </div>
          ) : null}

          {!isLoading && !resolvingPlaceId && !error
            ? suggestions.map((suggestion) => (
                <button
                  key={suggestion.placeId}
                  type="button"
                  onClick={() => handleSelectSuggestion(suggestion)}
                  className="block w-full px-4 py-3 text-left transition hover:bg-lime-50/70"
                >
                  <span className="block truncate text-sm font-semibold text-[#171814]">
                    {suggestion.mainText ?? suggestion.label}
                  </span>
                  {suggestion.secondaryText ? (
                    <span className="mt-0.5 block truncate text-xs font-medium text-[#747a6f]">
                      {suggestion.secondaryText}
                    </span>
                  ) : null}
                </button>
              ))
            : null}
        </div>
      ) : null}
    </label>
  );
}
