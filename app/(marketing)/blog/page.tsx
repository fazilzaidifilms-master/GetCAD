import Link from "next/link";
import type { Metadata } from "next";

import { BLOG_POSTS } from "@/components/marketing/blog-posts";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata(
  "Blog",
  "Notes on jewelry CAD production, manufacturing constraints, and the architecture behind The CAD Pillar.",
  "/blog",
);

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "long" }).format(new Date(iso));
}

export default function BlogIndexPage() {
  const posts = [...BLOG_POSTS].sort((a, b) => (a.date < b.date ? 1 : -1));

  return (
    <section className="container max-w-2xl py-16">
      <p className="text-sm font-medium text-primary">Blog</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">Notes on production and process</h1>
      <p className="mt-4 text-sm text-muted-foreground">
        Writing on jewelry CAD production, manufacturing constraints, and the architecture behind
        how the platform operates.
      </p>

      <ul className="mt-10 divide-y divide-border">
        {posts.map((post) => (
          <li key={post.slug} className="py-6 first:pt-0">
            <Link href={`/blog/${post.slug}`} className="group block">
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="rounded-full border border-border px-2 py-0.5">{post.category}</span>
                <time dateTime={post.date}>{formatDate(post.date)}</time>
                <span>·</span>
                <span>{post.readTimeMinutes} min read</span>
              </div>
              <p className="mt-2 text-lg font-medium group-hover:text-primary">{post.title}</p>
              <p className="mt-1.5 text-sm text-muted-foreground">{post.excerpt}</p>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
