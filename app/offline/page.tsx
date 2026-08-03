import { Wordmark } from "@/components/wordmark";

/**
 * Shown when a navigation fails and there is no network.
 *
 * It deliberately shows NOTHING about any order. The service worker could have
 * cached the last page you looked at and shown you that instead — most offline
 * implementations do — but a stale balance or an out-of-date status presented
 * as current is worse than an honest blank. Money moves in this app while you
 * are not looking at it.
 *
 * Static on purpose: it has to be precacheable, which means no data fetching
 * and nothing role-dependent.
 */
export const metadata = { title: "Offline" };

export default function OfflinePage() {
  return (
    <main className="container flex min-h-[70vh] max-w-md flex-col items-center justify-center py-12 text-center">
      <Wordmark className="text-[length:var(--fs-4)]" />

      <h1 className="mt-8 text-[length:var(--fs-5)] font-semibold leading-[var(--lh-5)] tracking-[var(--ls-5)]">
        You&apos;re offline
      </h1>

      <p className="mt-2 text-[length:var(--fs-4)] leading-[var(--lh-4)] text-muted-foreground">
        We don&apos;t show orders from a cache. Balances and statuses change while you&apos;re away,
        and a stale number is worse than none — so this waits until you&apos;re back.
      </p>

      <p className="mt-6 text-[length:var(--fs-2)] text-muted-foreground">
        Nothing you had open was lost. Reconnect and reload.
      </p>
    </main>
  );
}
