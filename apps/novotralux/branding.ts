// Fallback branding for the Custom instance, used before the organization row is read (SSR and the login page).
// The assets are served from this repository's public/ directory, so they work identically in local development
// and in Production instead of depending on an external host. The organization row can override both.
export const novotraluxBranding = Object.freeze({
  displayName: 'Novotralux',
  applicationTitle: 'NOVOTRALUX Dispatch',
  accentColor: '#C8FF00',
  logoUrl: '/logo-novotralux5.png',
  faviconUrl: '/logo-novotralux5.png',
})
