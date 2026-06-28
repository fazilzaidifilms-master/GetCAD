import { Button } from "@/components/ui/button";

// Throwaway page — proves the app boots. No business logic lives in app/.
export default function Home() {
  return (
    <main className="container flex min-h-screen flex-col items-center justify-center gap-6 py-16 text-center">
      <h1 className="text-3xl font-semibold tracking-tight">GetCAD</h1>
      <p className="max-w-md text-muted-foreground">
        Foundation is up. Schema and default-deny RLS live in <code>db/</code>;
        framework-agnostic logic lives in <code>core/</code>.
      </p>
      <Button>It runs.</Button>
    </main>
  );
}
