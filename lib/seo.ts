import type { Metadata } from "next";

// Public, non-secret. Used only to build absolute canonical/OG URLs and the
// sitemap. Falls back to localhost so nothing breaks if unset; set the real
// production domain via NEXT_PUBLIC_SITE_URL when one exists.
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(
  /\/$/,
  "",
);

export const SITE_NAME = "The CAD Pillar";

/** Consistent per-page metadata: title, description, canonical + OG, for marketing pages. */
export function pageMetadata(title: string, description: string, path: string): Metadata {
  const url = `${SITE_URL}${path}`;
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      url,
      siteName: SITE_NAME,
      type: "website",
      locale: "en_US",
    },
  };
}
