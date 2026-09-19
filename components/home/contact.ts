/* ------------------ Contact configuration ------------------ */

/**
 * WhatsApp number used by the contact section (+352 691 280 494).
 * International format, digits only: no "+", no spaces.
 */
export const WHATSAPP_NUMBER = "352691280494";

export const WHATSAPP_GREETING = "Bonjour, je souhaite en savoir plus sur Gerard.";

export const isWhatsAppConfigured = () => /^\d{8,15}$/.test(WHATSAPP_NUMBER);

export function whatsAppUrl(text: string) {
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`;
}

/* ------------------ Contact submission ------------------ */

export type ContactPayload = {
  name: string;
  company: string;
  email: string;
  phone?: string;
  message: string;
};

function formatForWhatsApp(p: ContactPayload) {
  return [
    WHATSAPP_GREETING,
    "",
    `Nom : ${p.name}`,
    `Société : ${p.company}`,
    `Email : ${p.email}`,
    p.phone ? `Téléphone : ${p.phone}` : null,
    `Message : ${p.message}`,
  ]
    .filter((line) => line !== null)
    .join("\n");
}

/**
 * Single entry point for sending the contact form.
 *
 * Temporary behaviour: opens WhatsApp with the form content prefilled.
 * Nothing is sent by Gerard itself. To switch to email (e.g. Resend), replace the
 * body with a POST to an API route and keep this signature: the component only
 * relies on the promise resolving (sent) or rejecting (error).
 */
export async function submitContact(payload: ContactPayload): Promise<void> {
  if (!isWhatsAppConfigured()) {
    throw new Error("WHATSAPP_NUMBER n’est pas configuré.");
  }
  const win = window.open(whatsAppUrl(formatForWhatsApp(payload)), "_blank", "noopener,noreferrer");
  // window.open returns null with noopener; nothing more to await here.
  void win;
}
