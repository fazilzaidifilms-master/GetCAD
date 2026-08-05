import { SignIn } from "@clerk/nextjs";

import { POST_AUTH_PATH } from "@/config/auth-redirects";

export const metadata = { title: "Sign in" };

export default function SignInPage() {
  return (
    <main className="flex min-h-[80vh] items-center justify-center py-16">
      {/* Without fallbackRedirectUrl, Clerk returns people to `/` — the marketing
          homepage — which looks exactly like sign-in having failed. See
          config/auth-redirects for why this is fallback rather than force. */}
      <SignIn fallbackRedirectUrl={POST_AUTH_PATH} signUpUrl="/sign-up" />
    </main>
  );
}
