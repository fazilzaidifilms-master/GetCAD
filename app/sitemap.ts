import type { MetadataRoute } from "next";

import { BLOG_POSTS } from "@/components/marketing/blog-posts";
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
  "/contact",
  "/blog",
  "/privacy",
  "/terms",
];

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const staticEntries = ROUTES.map((path) => ({
    url: `${SITE_URL}${path}`,
    lastModified: now,
    changeFrequency: "monthly" as const,
    priority: path === "" ? 1 : 0.7,
  }));
  const postEntries = BLOG_POSTS.map((post) => ({
    url: `${SITE_URL}/blog/${post.slug}`,
    lastModified: new Date(post.date),
    changeFrequency: "monthly" as const,
    priority: 0.6,
  }));
  return [...staticEntries, ...postEntries];
}
