// Ambient module declarations so `tsc --noEmit` type-checks cleanly WITHOUT
// relying on the auto-generated next-env.d.ts (CI runs typecheck before build).
declare module "*.css";
