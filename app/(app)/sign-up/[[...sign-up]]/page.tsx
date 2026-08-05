import { SignUp } from "@clerk/nextjs";

import { POST_AUTH_PATH } from "@/config/auth-redirects";

export const metadata = { title: "Create an account" };

export default function SignUpPage() {
  return (
    <main className="flex min-h-[80vh] items-center justify-center py-16">
      <SignUp fallbackRedirectUrl={POST_AUTH_PATH} signInUrl="/sign-in" />
    </main>
  );
}
