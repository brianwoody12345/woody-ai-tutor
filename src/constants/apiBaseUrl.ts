// Central place to configure the backend API base URL.
//
// Priority order:
// 1) VITE_API_BASE_URL (explicit override)
// 2) Local dev: "" so Vite can proxy /api (see vite.config.ts)
// 3) Deployed on Vercel: same-origin
// 4) Lovable Preview/other: fallback to the stable production backend

const FALLBACK_VERCEL_BACKEND = 'https://woody-ai-tutor.vercel.app';

function computeApiBaseUrl() {
  const fromEnv = import.meta.env.VITE_API_BASE_URL;
  if (fromEnv) return fromEnv;

  if (import.meta.env.DEV) return '';

  if (typeof window !== 'undefined') {
    const host = window.location.hostname;

    // Lovable preview/published runs on a different origin than your backend.
    if (host.includes('lovable')) return FALLBACK_VERCEL_BACKEND;

    // On Vercel (or your custom domain), same-origin calls work and avoid CORS.
    return window.location.origin;
  }

  return FALLBACK_VERCEL_BACKEND;
}

export const API_BASE_URL = computeApiBaseUrl();

