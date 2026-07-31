# How The CAD Pillar works

The whole system, end to end: how an order moves, where the money sits at every
moment, what each side is allowed to see, and what the platform does on its own.

Companion document: [OPERATIONS.md](./OPERATIONS.md) — the roles, every action
each can take, and the runbook.

> **The one-sentence version.** A jewelry business orders a CAD model and pays up
> front into escrow; an anonymous vetted designer produces it; an independent
> reviewer who did not make it checks it; the client approves; only then does the
> money split and leave — and neither side ever learns who the other is.

---

## 1. The three parties

| | Who | What they see |
|---|---|---|
| **Demand** | **The client** — a jewelry business needing a CAD model | An order, price, timeline, files and a message thread labelled only *"Designer"*. Pays before work starts, approves before money is released. |
| **Platform** | **The CAD Pillar** | Holds money in escrow, keeps identities apart, enforces independent review, records everything in a tamper-evident log. Takes a commission per order. |
| **Supply** | **The designer** — vetted, agreement-signed | The brief and a thread labelled only *"Client"* — never a company name. |

---

## 2. The order lifecycle

17 states, 24 legal transitions. Each row is who moves it and what happens.

| State | Who acts | What happens |
|---|---|---|
| `DRAFT` | **Client** | A private scratchpad. Invisible to staff and designers; no money on the order. Cancellable. |
| `SUBMITTED` | **Client** | Enters the business. Appears in the **Sales** queue only. Still cancellable. |
| `QUOTED` | **Sales** | Sets total, designer payout, QC payout, platform commission. **The three parts must sum exactly to the total** or the quote is refused. Client sees a Pay button. |
| `PAYMENT_HELD` | **Client pays → Razorpay confirms** | The client *cannot* mark their own order paid. Only Razorpay's signed webhook moves it here. Full amount now in escrow. Enters the **Ops** queue. |
| `ASSIGNED` | **Ops** | Assigns a designer. The system refuses anyone not currently assignable, and refuses assigning to the order's own QC reviewer. |
| `IN_PROGRESS` | **Designer** | Work starts. Client↔designer messaging opens, by role label only. Client may raise a dispute from here. |
| `DESIGNER_SUBMITTED` | **Designer** | Uploads the deliverable. **Files are stripped of identifying metadata on the way in.** Enters the **Ops** queue. |
| `QC_REVIEW` | **Ops** | Sends it to the QC pool. Reviewers are not pre-assigned — whoever is free picks it up. |
| `CLIENT_PREVIEW` *or* `REVISION_REQUESTED` | **QC** | Passes or returns. The reviewer is recorded at the moment of decision, and **the system refuses the review if they produced the work or own the order**. |
| `APPROVED` | **Client** | Signs off on the QC-passed work. May instead request a revision, or dispute. |
| `DELIVERED` | **Ops** | Releases final files to the client. |
| `CLOSED` | **Client or Ops** | Job finished. Enters the **Finance** queue — only now can money leave. |
| `PAYOUT_RELEASED` | **Finance** | Escrow splits three ways and drains to zero. **Refused if any payee has no verified bank account.** |

**Off the happy path:** `CANCELLED` (client, before paying) · `DISPUTED`
(client, during work or at preview — requires a written reason) · `REFUNDED`
(Finance, full or partial).

---

## 3. Where the money is, moment by moment

On a ₹50,000 order:

| Event | What happens | Escrow |
|---|---|---|
| **Quote** | Sales fixes price and the three-way split. No money moves. | ₹0 |
| **Hold** | Client pays. Razorpay's signed webhook — *not the client* — credits escrow. | ₹50,000 |
| *work* | Design, QC, revisions, approval. Balance does not move however long this takes. | ₹50,000 |
| **Release** | Finance releases on a `CLOSED` order. Three legs at once: designer, QC, platform. | ₹0 (owed out) |
| **Transfer** | The payout worker sends each leg to the payee's bank via Razorpay Route. | ₹0 (in flight) |
| **Reversal** | A bounced transfer credits escrow *again*, so money is never lost. | restored |
| **Refund** | Finance returns money to the client — fully or partially, while held. | reduced |

> **The rule underneath all of it:** every rupee released or refunded traces back
> to a rupee that was collected. Enforced by a trigger on the ledger table — no
> script, webhook, or staff member can take more out of an order than went in.

---

## 4. The anonymity wall

**A client can see:** their own orders, prices and status history · files
delivered on their orders · messages labelled "Designer" · that an independent
reviewer passed the work.

**A client cannot see:** the designer's name, email, country or profile · which
reviewer checked it · any other client's orders.

**A designer can see:** orders assigned to them and the brief · their payout
amount and status · messages labelled "Client".

**A designer cannot see:** the client's company, name or contact · what the
client was actually charged · other designers' orders or rates · their own
stored bank number or PAN in full (only the last four).

**Why it holds.** Orders carry no names — only opaque ids. Client identity and
designer identity live in two separate tables that never touch each other or the
orders table. Messages store a role label, not a person. Delivered files are
stripped of authoring metadata. The wall isn't staff being careful; there is
nothing in the record for either side to read.

---

## 5. How a designer becomes a designer

Five gates between "applied" and "can be given paid work".

1. **Applies** — public form at `/apply-designer`. Name, contact, country,
   experience, software, categories, portfolio (link or 2–3 files). Immediate
   acknowledgement email. **No account is created** — this is a lead.
2. **Reviewed** — Ops or Sales accepts/declines at `/admin/applications`,
   opening portfolios through short-lived private links. Applicant is emailed
   either way. Accepting records a decision; it does **not** create an account.
3. **Signs up** — the accepted candidate creates an account and applies in-app.
   Status becomes `PENDING`: they exist but cannot be given work.
4. **Signs the agreement** — the signature stores a fingerprint of the exact
   text shown, so nobody can be held to terms they never saw. Publishing a new
   version automatically re-gates every designer. Status becomes `ACTIVE`.
5. **Banks with us** — payout details at `/settings/payouts`, then you link them
   to the processor. **Until this is done, no payout for them can be released.**

---

## 6. What runs without anyone touching it

- **Payment confirmation** — Razorpay's signed webhook. Unsigned or tampered
  messages refused; duplicates ignored rather than double-funding.
- **Payout settlement** — transfer results mark each payout paid or reversed. A
  payout lost mid-flight is recoverable by asking the processor what happened.
- **In-app notifications** — quote, assignment, message, file, preview,
  delivery, dispute, payout — to the right party, identity-free, never to the
  person who caused the event.
- **Transactional email** — queued in the same instant as the event, sent
  separately, so a mail outage can delay an email but never lose an application
  or a payment.
- **The audit log** — every state change, money movement and decision appended
  to a hash-chained record that cannot be edited or deleted.
- **Abuse limits** — public forms rate-limited per network address, stored only
  as a one-way hash.

---

## 7. Seven things that cannot go wrong

Enforced in the database, not by discipline.

1. **A client cannot fund their own order.** The ability was revoked entirely;
   only a signature-verified processor message moves money into escrow.
2. **Money is always conserved.** A quote's split must sum to the total; payouts
   must consume exactly what is held. Enforced on the table itself.
3. **Nobody reviews their own work.** The reviewer is recorded at decision time,
   and a review by the producer or the order's owner is refused.
4. **Work only goes to vetted designers.** Assignment refuses anyone not active
   with a current signed agreement.
5. **A payout is paid exactly once.** One payout per release obligation,
   enforced by a uniqueness constraint — the failure mode being prevented is
   paying a designer twice out of platform funds.
6. **History cannot be rewritten.** The audit log and money ledger are
   append-only, including for the platform's own scripts.
7. **Everything is denied by default.** Every table starts closed; access exists
   only where a rule explicitly opens it. A forgotten table fails shut.

---

*Every state, transition, actor and rule above is taken from the live schema —
the 24 legal transitions, the role gates, and the enforced invariants.*
