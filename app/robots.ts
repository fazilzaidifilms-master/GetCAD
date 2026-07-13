import type { MetadataRoute } from "next";

import { SITE_URL } from "@/lib/seo";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/dashboard", "/orders", "/admin", "/onboarding", "/sign-in", "/sign-up", "/api"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
