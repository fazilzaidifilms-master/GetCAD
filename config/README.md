# config/

Centralized, typed configuration. Rules for this directory:

- Server secrets are read **server-side only**. A secret must NEVER be exposed
  to the browser via a `NEXT_PUBLIC_*` variable — the secret-scan CI step fails
  the build if it sees one.
- This slice (foundation) ships **no runtime secrets**. The Supabase connection,
  the Clerk JWT bridge, and signed-URL keys arrive in later slices and will be
  validated here at process start.
