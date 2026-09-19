import type { NextApiRequest, NextApiResponse } from "next";
import { requirePermission } from "../../../lib/auth/authorization";
import { permissions } from "../../../lib/auth/permissions";

type GooglePlaceDetailsResponse = {
  id?: string;
  formattedAddress?: string;
  location?: {
    latitude?: number;
    longitude?: number;
  };
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (!(await requirePermission(req, res, permissions.missionsView))) return;
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { placeId } = req.query;

  if (typeof placeId !== "string" || placeId.trim().length === 0) {
    return res.status(400).json({ error: "placeId is required" });
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;

  if (!apiKey) {
    return res.status(500).json({ error: "GOOGLE_MAPS_API_KEY is missing" });
  }

  try {
    const normalizedPlaceId = placeId.trim().replace(/^places\//, "");
    const response = await fetch(
      `https://places.googleapis.com/v1/places/${encodeURIComponent(
        normalizedPlaceId,
      )}`,
      {
        headers: {
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": "id,formattedAddress,location",
        },
      },
    );

    if (!response.ok) {
      console.error("Google Place Details request failed", response.status);
      return res.status(500).json({
        error: "Google Place Details request failed",
      });
    }

    const data = (await response.json()) as GooglePlaceDetailsResponse;
    const lat = data.location?.latitude;
    const lng = data.location?.longitude;

    if (
      !data.id ||
      !data.formattedAddress ||
      typeof lat !== "number" ||
      typeof lng !== "number"
    ) {
      return res.status(500).json({ error: "Invalid Google Place Details" });
    }

    return res.status(200).json({
      placeId: data.id,
      address: data.formattedAddress,
      lat,
      lng,
    });
  } catch (error) {
    console.error("Failed to load Google Place Details", error);
    return res.status(500).json({ error: "Failed to load place details" });
  }
}
