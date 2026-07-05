import type { MetadataRoute } from "next";

import { SITE_URL } from "@/lib/seo";

// Public marketing routes only — the authenticated product is intentionally
// excluded (nothing there is meant for search engines; see robots.ts).
const ROUTES = [
  "",
  "/how-it-works",
  "/quality-control",
  "/security",
  "/about",
  "/for-designers",
  "/privacy",
  "/terms",
];

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return ROUTES.map((path) => ({
    url: `${SITE_URL}${path}`,
    lastModified: now,
    changeFrequency: "monthly" as const,
    priority: path === "" ? 1 : 0.7,
  }));
}
