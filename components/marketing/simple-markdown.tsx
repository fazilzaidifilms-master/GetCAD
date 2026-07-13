import type { ReactNode } from "react";

// Minimal, dependency-free renderer for blog post bodies. Builds React nodes
// directly (no dangerouslySetInnerHTML) so nothing is injected. Supports:
// #/## headings, - list items, blank lines as spacing, **bold** inline.
// Self-contained — deliberately not shared with the app-side agreement
// renderer, to keep the marketing site's rendering independent.
function renderInline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    return <span key={i}>{part}</span>;
  });
}

export function SimpleMarkdown({ body }: { body: string }) {
  const lines = body.split("\n");
  return (
    <div className="space-y-4 text-sm leading-relaxed text-muted-foreground">
      {lines.map((line, i) => {
        if (line.startsWith("## ")) {
          return (
            <h2 key={i} className="!mt-8 text-lg font-semibold text-foreground">
              {renderInline(line.slice(3))}
            </h2>
          );
        }
        if (line.startsWith("# ")) {
          return (
            <h2 key={i} className="!mt-8 text-xl font-semibold text-foreground">
              {renderInline(line.slice(2))}
            </h2>
          );
        }
        const listItem = line.match(/^\s*[-*]\s+(.*)$/);
        if (listItem) {
          return (
            <li key={i} className="ml-5 list-disc">
              {renderInline(listItem[1] ?? "")}
            </li>
          );
        }
        if (line.trim() === "") return null;
        return <p key={i}>{renderInline(line)}</p>;
      })}
    </div>
  );
}
