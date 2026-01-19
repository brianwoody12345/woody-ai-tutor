// Central place to configure the backend API base URL.
// - In local dev, Vite proxies /api to the Vercel backend (see vite.config.ts), so "" works.
// - In Lovable Preview/Published, the proxy is not used, so we default to the hosted backend.
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "https://woody-ai-tutor.vercel.app";
