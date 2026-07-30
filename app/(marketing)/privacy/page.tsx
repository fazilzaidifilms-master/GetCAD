import type { Metadata } from "next";

import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata(
  "Privacy Policy",
  "What The CAD Pillar collects, why, and how it is handled — in plain language.",
  "/privacy",
);

/**
 * A factual description of what the platform actually collects and does with
 * it, derived from the schema rather than from a template. Deliberately plain
 * language, and deliberately NOT dressed up as counsel-reviewed legal text —
 * see the note at the foot of the page.
 */
const SECTIONS: { heading: string; body: string[] }[] = [
  {
    heading: "What we collect, and when",
    body: [
      "If you contact us through this website, we store the name, company, email address and message you submit.",
      "If you apply as a CAD designer, we store your name, email address, phone number, country, years of experience, primary software, the jewelry categories you work in, and either a portfolio link or the portfolio files you upload.",
      "If you hold an account, we store an account identifier from our authentication provider, your role, and your account status. Your name and email are held separately from your orders.",
      "When an order is placed, we store the order's details, its status history, the files exchanged, and the messages sent within it.",
      "If you are paid through the platform — as a designer or a quality reviewer — we store the bank details needed to send that money: the account holder's name, the account number, the IFSC, the account type, and the PAN our payment processor requires to make a payout to an Indian bank account.",
    ],
  },
  {
    heading: "How your bank details are held",
    body: [
      "They are kept apart from everything else and are readable by no one through the ordinary application — including you. When you look at your payout settings you are shown only the last four characters of your account number and PAN, which is enough to recognise the account without exposing it.",
      "They are never visible to clients, are not attached to your order history, and are never written into our activity records — those log only that an account was submitted, along with the last four digits.",
      "Changing your bank details always sends them for verification again. We will not pay out to details that have not been confirmed.",
    ],
  },
  {
    heading: "Anonymity between clients and designers",
    body: [
      "Clients and designers never see each other's identity. This is enforced by how the system is built, not by policy: order records, messages and files carry no name, email or contact detail for either side, and each party is shown only by role.",
      "Identifying metadata is removed from delivered files before they are stored — camera and author fields in images, author and organisation fields in CAD files — so a deliverable cannot reveal who produced it.",
      "Independent quality review is performed by someone who did not produce the work. That reviewer is identified to both parties by role only.",
    ],
  },
  {
    heading: "Payments",
    body: [
      "Payments are processed by Razorpay. We never receive or store your card details. We store the payment references Razorpay gives us so a payment can be reconciled to an order, along with the amounts involved.",
    ],
  },
  {
    heading: "Records and retention",
    body: [
      "Every state change on an order is written to an append-only record — it can be added to, but not edited or deleted. This is what makes the platform's history verifiable, and it means order history is retained rather than erased.",
      "Files are stored privately and are reachable only through short-lived links issued to people entitled to see them.",
    ],
  },
  {
    heading: "Abuse prevention",
    body: [
      "To limit automated abuse of our public forms we record how often submissions arrive from a network address. We store only a salted, one-way hash of that address — never the address itself.",
    ],
  },
  {
    heading: "Who we share it with",
    body: [
      "We do not sell your information. We share it only with the service providers needed to run the platform — our authentication provider, our database and file hosting provider, and our payment processor — and only to the extent each needs to perform its function.",
    ],
  },
  {
    heading: "Your choices",
    body: [
      "You can ask what we hold about you, ask us to correct it, or ask us to delete it. Where information forms part of a financial or audit record we may need to retain it, and we will tell you if that applies.",
      "To make a request, contact us through the form on this site.",
    ],
  },
];

export default function PrivacyPage() {
  return (
    <section className="container max-w-2xl py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Privacy Policy</h1>
      <p className="mt-4 text-sm text-muted-foreground">
        This describes what The CAD Pillar collects, why, and how it is handled. It is written in
        plain language rather than legal boilerplate, and it reflects how the platform is actually
        built.
      </p>

      <div className="mt-10 space-y-8">
        {SECTIONS.map((section) => (
          <div key={section.heading}>
            <h2 className="font-medium">{section.heading}</h2>
            {section.body.map((paragraph) => (
              <p key={paragraph} className="mt-2 text-sm text-muted-foreground">
                {paragraph}
              </p>
            ))}
          </div>
        ))}
      </div>

      <div className="mt-10 rounded-lg border border-border bg-subtle p-4">
        <p className="text-sm font-medium">A note on this document</p>
        <p className="mt-2 text-sm text-muted-foreground">
          This is an accurate description of our practices, but it has not been reviewed by legal
          counsel and is not a substitute for advice from one. A counsel-reviewed policy will
          replace it before the platform is generally available. If anything here matters to a
          decision you are making, please ask us.
        </p>
      </div>
    </section>
  );
}
