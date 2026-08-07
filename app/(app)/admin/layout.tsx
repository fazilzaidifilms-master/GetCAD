/**
 * Staff screens keep the density they were built with.
 *
 * Everything under /admin is worked all day, forty orders at a time, by people
 * who need as many rows on screen as will fit. The comfortable sizing that
 * makes the client app legible on a phone would cost them a third of every
 * list.
 *
 * This is the ONLY place the compact density is switched on. It sets an
 * attribute rather than a class so it survives a className edit, and because
 * one attribute in the DOM answers "which density am I looking at" when a
 * screenshot doesn't.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <div data-density="compact">{children}</div>;
}
