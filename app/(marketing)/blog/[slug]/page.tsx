import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { CtaSection } from "@/components/marketing/cta-section";
import { BLOG_POSTS, getPostBySlug } from "@/components/marketing/blog-posts";
import { SimpleMarkdown } from "@/components/marketing/simple-markdown";
import { pageMetadata } from "@/lib/seo";

export function generateStaticParams() {
  return BLOG_POSTS.map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const post = getPostBySlug((await params).slug);
  if (!post) return pageMetadata("Post not found", "This post doesn't exist.", "/blog");
  return pageMetadata(post.title, post.excerpt, `/blog/${post.slug}`);
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "long" }).format(new Date(iso));
}

export default async function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const post = getPostBySlug((await params).slug);
  if (!post) notFound();

  return (
    <>
      <article className="container max-w-2xl py-16">
        <Link href="/blog" className="text-sm text-muted-foreground hover:text-foreground">
          ← All posts
        </Link>

        <div className="mt-4 flex items-center gap-3 text-xs text-muted-foreground">
          <span className="rounded-full border border-border px-2 py-0.5">{post.category}</span>
          <time dateTime={post.date}>{formatDate(post.date)}</time>
          <span>·</span>
          <span>{post.readTimeMinutes} min read</span>
        </div>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">{post.title}</h1>

        <div className="mt-8">
          <SimpleMarkdown body={post.body} />
        </div>
      </article>

      <div className="py-16">
        <CtaSection />
      </div>
    </>
  );
}
