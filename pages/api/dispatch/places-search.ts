import type { NextApiRequest, NextApiResponse } from "next";
import { requirePermission } from "../../../lib/auth/authorization";
import { permissions } from "../../../lib/auth/permissions";
import {
  detectCountry,
  supportedRegionCodes,
} from "../../../lib/dispatch/maps/europe-coverage";

type GooglePlacePrediction = {
  placeId?: string;
  text?: {
    text?: string;
  };
  structuredFormat?: {
    mainText?: {
      text?: string;
    };
    secondaryText?: {
      text?: string;
    };
  };
};

type GoogleSuggestion = {
  placePrediction?: GooglePlacePrediction;
};

type GoogleAutocompleteResponse = {
  suggestions?: GoogleSuggestion[];
};

type PlaceSuggestion = {
  placeId: string;
  label: string;
  mainText?: string;
  secondaryText?: string;
};

type GoogleErrorPayload = {
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
};

function isGoogleErrorPayload(value: unknown): value is GoogleErrorPayload {
  return (
    typeof value === "object" &&
    value !== null &&
    "error" in value
  );
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (!(await requirePermission(req, res, permissions.missionsView))) return;
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { query } = req.query;

  if (typeof query !== "string" || query.trim().length < 3) {
    return res.status(400).json({ error: "Query must be at least 3 chars" });
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;

  if (!apiKey) {
    return res.status(500).json({ error: "GOOGLE_MAPS_API_KEY is missing" });
  }

  const detectedCountry = detectCountry(query);

  try {
    const response = await fetch(
      "https://places.googleapis.com/v1/places:autocomplete",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask":
            "suggestions.placePrediction.placeId,suggestions.placePrediction.text.text,suggestions.placePrediction.structuredFormat.mainText.text,suggestions.placePrediction.structuredFormat.secondaryText.text",
        },
        body: JSON.stringify({
          input: query.trim(),
          languageCode: "fr",
          // Couverture européenne complète : la restriction historique à
          // LU/FR/BE/DE rendait l'Espagne, le Portugal et l'Italie
          // introuvables depuis l'autocomplétion. Si l'utilisateur a déjà
          // tapé un pays, on cible ce pays pour lever les homonymies.
          includedRegionCodes: detectedCountry
            ? [detectedCountry.toLowerCase()]
            : supportedRegionCodes,
        }),
      },
    );

    const payload = (await response.json()) as unknown;

    if (!response.ok) {
      console.error("Google Places error:", {
        status: response.status,
        payload,
      });

      const googleMessage = isGoogleErrorPayload(payload)
        ? payload.error?.message
        : undefined;

      const googleStatus = isGoogleErrorPayload(payload)
        ? payload.error?.status
        : undefined;

      return res.status(response.status).json({
        error: "Google Places request failed",
        status: response.status,
        googleStatus,
        googleMessage,
      });
    }

    const data = payload as GoogleAutocompleteResponse;

    const suggestions: PlaceSuggestion[] = (data.suggestions ?? [])
      .map((suggestion) => suggestion.placePrediction)
      .filter((prediction): prediction is GooglePlacePrediction =>
        Boolean(prediction?.placeId && prediction.text?.text),
      )
      .map((prediction) => ({
        placeId: prediction.placeId ?? "",
        label: prediction.text?.text ?? "",
        mainText: prediction.structuredFormat?.mainText?.text,
        secondaryText: prediction.structuredFormat?.secondaryText?.text,
      }));

    return res.status(200).json({ suggestions });
  } catch (error) {
    console.error("Failed to search Google Places", error);

    return res.status(500).json({
      error: "Failed to search places",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
