import type { NextConfig } from "next";

// Baseline security headers — applied to every response. See
// docs/HIPAA_ASSESSMENT.md, finding #10/#11. A strict Content-Security-Policy
// is intentionally NOT added here; Next 16 + Turbopack + Tailwind 4 require
// case-by-case CSP tuning and that lands in a separate, tested PR.
//
// HSTS is included but only takes effect when the page is served over
// HTTPS — in dev (HTTP) browsers ignore it. The header on /api/* adds
// a no-store cache-control and a PHI classification flag so caches and
// proxies treat reconciliation responses uniformly with the FastAPI
// streams (see api/src/hathor/server.py:_PHI_STREAM_HEADERS).
const SECURITY_HEADERS = [
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
];

const PHI_API_HEADERS = [
  ...SECURITY_HEADERS,
  {
    key: "Cache-Control",
    value: "no-store, no-cache, must-revalidate, private",
  },
  { key: "Pragma", value: "no-cache" },
  { key: "X-Content-Classification", value: "PHI" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      { source: "/:path*", headers: SECURITY_HEADERS },
      { source: "/api/:path*", headers: PHI_API_HEADERS },
    ];
  },
};

export default nextConfig;
