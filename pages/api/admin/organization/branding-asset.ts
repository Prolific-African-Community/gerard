import { createReadStream } from 'fs'

import { put } from '@vercel/blob'
import formidable from 'formidable'
import type { File } from 'formidable'
import type { NextApiRequest, NextApiResponse } from 'next'

import { runWithCurrentOrganization } from '../../../../lib/auth/authorization'
import { requireOrganizationAdmin } from '../../../../lib/auth/organization-admin'
import {
  BRAND_ASSET_MAX_BYTES,
  brandAssetBlobPath,
  isBrandAssetKind,
  validateBrandAsset,
} from '../../../../lib/tenant/brand-assets'

// Uploads an organization logo or favicon and returns only its public URL: the image bytes never reach
// PostgreSQL, and the Blob token stays server-side.
export const config = { api: { bodyParser: false } }

const messages: Record<string, string> = {
  BRAND_ASSET_TYPE_UNSUPPORTED: 'Formats acceptés : PNG, JPG, WEBP, SVG ou ICO.',
  BRAND_ASSET_TOO_LARGE: `L’image ne doit pas dépasser ${Math.round(BRAND_ASSET_MAX_BYTES / (1024 * 1024))} MB.`,
  BRAND_ASSET_EMPTY: 'Le fichier est vide.',
}

function firstFile(files: formidable.Files): File | null {
  const candidate = files.file ?? Object.values(files)[0]
  const file = Array.isArray(candidate) ? candidate[0] : candidate
  return file ?? null
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const actor = await requireOrganizationAdmin(req, res)
  if (!actor) return
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Méthode non autorisée' })
  }
  // Without a Blob token the URL field stays the supported path; the form shows an "unavailable" state.
  const token = process.env.BLOB_READ_WRITE_TOKEN
  if (!token) return res.status(503).json({ error: 'Téléversement indisponible : stockage non configuré.', code: 'BRAND_ASSET_STORAGE_UNAVAILABLE' })

  return runWithCurrentOrganization(actor, async () => {
    const form = formidable({ maxFiles: 1, maxFileSize: BRAND_ASSET_MAX_BYTES, multiples: false })
    let fields: formidable.Fields
    let files: formidable.Files
    try {
      ;[fields, files] = await form.parse(req)
    } catch {
      return res.status(400).json({ error: messages.BRAND_ASSET_TOO_LARGE })
    }
    const rawKind = Array.isArray(fields.kind) ? fields.kind[0] : fields.kind
    const kind = isBrandAssetKind(rawKind) ? rawKind : 'logo'
    const file = firstFile(files)
    if (!file) return res.status(400).json({ error: 'Aucun fichier reçu.' })

    const rejection = validateBrandAsset(file)
    if (rejection) return res.status(400).json({ error: messages[rejection], code: rejection })

    const mimeType = (file.mimetype as string).trim().toLowerCase()
    const blob = await put(brandAssetBlobPath(actor.organizationId, kind, mimeType), createReadStream(file.filepath), {
      access: 'public',
      contentType: mimeType,
      token,
    })
    return res.status(201).json({ url: blob.url, kind })
  })
}
