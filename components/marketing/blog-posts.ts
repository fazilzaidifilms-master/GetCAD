export interface BlogPost {
  slug: string;
  title: string;
  excerpt: string;
  date: string; // ISO date
  readTimeMinutes: number;
  category: string;
  body: string; // simple markdown — see simple-markdown.tsx for the supported subset
}

// Starter/sample editorial content demonstrating the section's format and
// depth. Replace with real posts as they're written — these are illustrative,
// not published articles.
export const BLOG_POSTS: BlogPost[] = [
  {
    slug: "why-cad-files-fail-in-casting",
    title: "Why CAD Files Fail in Casting: Five Structural Issues to Check Before Sign-Off",
    excerpt:
      "A model that looks correct on screen can still fail once it reaches manufacturing. Here are the five most common structural issues an independent reviewer catches before a client ever sees the file.",
    date: "2026-05-12",
    readTimeMinutes: 6,
    category: "Manufacturing",
    body: `A CAD file can render perfectly and still be unmanufacturable. The gap between "looks right" and "casts right" is where most production failures come from, and it's rarely obvious from a screenshot or a rendered preview. Here are the five issues that come up most often in independent review, before a file ever reaches a client.

## 1. Wall thickness below casting tolerance

A wall that's visually thin but technically present in the model will often fail during casting — either collapsing during the burnout stage or coming out porous. The fix is usually straightforward once caught, but it has to be caught deliberately; it's invisible in a standard render.

## 2. Non-manifold geometry

Overlapping faces, internal duplicate surfaces, and gaps at vertices don't stop a file from *opening* — they stop it from being *printed or milled correctly*. A model can pass every visual check and still contain non-manifold geometry that a slicer or CAM tool will choke on.

## 3. Stone seats cut without clearance

A seat modeled to the exact stone dimension, with zero tolerance, will not accommodate the physical stone once cut and polished. Real stones vary slightly from their nominal dimensions; seats need to account for that variance, not just match a spec sheet number.

## 4. Insufficient prong or bezel material at the base

Prongs and bezels are frequently modeled thin at the tip (where it's visually expected) but also thin at the base, where the real structural load is. A prong that looks fine from the front can be under-supported from the side.

## 5. File units and scale mismatches

A model built in the wrong unit system, or scaled incorrectly during export, will produce a piece at the wrong physical size — sometimes by a small, easy-to-miss margin that doesn't show up until the finished piece doesn't fit.

## The pattern

None of these are exotic problems. They're common, well-understood failure modes — which is exactly why a dedicated, independent review step exists before a file reaches a client. The person who built the model is the least likely person to catch their own blind spots in it.`,
  },
  {
    slug: "anonymity-is-an-architecture",
    title: "Anonymity Isn't a Feature. It's an Architecture.",
    excerpt:
      "Most marketplaces treat privacy as a setting someone can turn off. Double-blind anonymity only works if it's structural — if there's nowhere in the system identity could leak, even by accident.",
    date: "2026-04-03",
    readTimeMinutes: 5,
    category: "Architecture",
    body: `Most platforms that claim to protect user privacy do it with a policy: a rule that says employees shouldn't share your contact details, or a setting a user can toggle. That's a promise, not a guarantee — it depends on every person and every process following the rule correctly, forever.

## The structural alternative

A different approach is to make identity leakage impossible by construction, rather than merely discouraged by policy. That means: the records that describe an order — its status, its files, its messages — simply have no field where a name, an email address, or a phone number could be stored. Not "we don't populate that field." There is no field.

## Why this matters for a two-sided marketplace

In a jewelry CAD marketplace, both sides have a real reason to want this:

- **Clients** don't want a designer soliciting them directly, undercutting the platform relationship, or building leverage from knowing who they are.
- **Designers** don't want a client going around them to source cheaper on a future order, or leaving a review that identifies them personally in an industry where reputation moves fast.

A policy-based "please don't share contact info" doesn't hold up under real incentive to break it. A structural guarantee — there's nowhere to put it — does.

## What this looks like in practice

Every message between a client and a designer is labeled only by role: "Client" or "Designer," never a name. A participant can read the entire conversation history for an order and learn nothing about who's on the other end. The same applies to the independent QC reviewer — they're identified to both parties only by role.

## The trade-off is real, and worth it

Structural anonymity means some things a normal marketplace makes easy — direct relationship-building, repeat-client discounts negotiated informally, reputation systems tied to a real identity — don't work the same way here. That's the point. The entire value of the anonymity guarantee comes from it being non-negotiable.`,
  },
  {
    slug: "the-real-cost-of-skipping-qc",
    title: "The Real Cost of Skipping Independent QC in Jewelry Manufacturing",
    excerpt:
      "Independent review adds a step to production. Skipping it doesn't remove the cost — it just moves the cost downstream, where it's more expensive and harder to trace back to its source.",
    date: "2026-03-18",
    readTimeMinutes: 5,
    category: "Quality Control",
    body: `Every step added to a production process has a cost — time, coordination, sometimes a delay in delivery. It's tempting to treat independent QC as overhead that can be trimmed once a designer has proven themselves reliable. In practice, that trade rarely pays off.

## The cost doesn't disappear — it moves

An error caught during CAD review costs a revision cycle: hours, not days. The same error caught after casting costs the metal, the casting run, and the time to redo it. Caught after a client has already approved a preview, it costs client trust as well. The cost of an error is not fixed — it grows the further downstream it travels before being caught.

## Why the same designer can't catch it

This isn't about competence. A designer who has been staring at the same file for hours has, by definition, already convinced themselves the geometry is correct — that's what "finishing" a model means. The kind of error that survives to the end of a design session is, almost by construction, the kind of error the designer's own mental model has stopped flagging. An independent reviewer isn't smarter; they're looking at it for the first time, which is the actual advantage.

## Independence has to be real, not nominal

A "review" performed by someone who reports to the designer, or who reviews the same designer's work every time, tends to converge toward rubber-stamping over time — not through bad faith, but through familiarity. For the review to keep doing its job, the reviewer has to be genuinely independent: a different person, assigned without a standing relationship to the work, whose only stake in the outcome is whether the piece is actually correct.

## What a real QC gate looks like

A mandatory, independent QC stage that a client can see happened — not just trust happened — turns "we have quality control" from a claim into something verifiable. When an order's record shows an independent reviewer passed or rejected a specific version, at a specific time, quality control stops being a policy statement and becomes an auditable fact.`,
  },
];

export function getPostBySlug(slug: string): BlogPost | undefined {
  return BLOG_POSTS.find((p) => p.slug === slug);
}
