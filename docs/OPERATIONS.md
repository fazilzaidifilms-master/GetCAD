# Running the business

Who does what, exactly what each role can and cannot do, how to set your team
up, and what to do when something goes sideways.

Companion document: [SYSTEM.md](./SYSTEM.md) — the lifecycle, money custody and
the anonymity model.

> **Read this first.** Permissions are enforced in the database, not in the
> screens. A person with the wrong role doesn't see a disabled button — the
> action simply fails, and usually the order was never visible to them at all.
> That's deliberate: the UI can be wrong without the business being wrong.

---

## 1. The roles

| Role | What they're for | Where they sit in the flow |
|---|---|---|
| **CLIENT** | The paying customer. Default for everyone who signs up. | Creates and submits orders, pays, previews, approves, closes, disputes. |
| **DESIGNER** | Produces the CAD work. Vetted, agreement-signed, paid per order. | Accepts assigned work, uploads deliverables, reworks, gets paid. |
| **SALES** | Prices the work — the commercial gate. | Quotes submitted orders. Works the lead and application inboxes. |
| **OPS** | Runs the pipeline — the traffic controller. | Assigns designers, sends to QC, delivers, closes, resolves disputes by rework. |
| **QC** | Independent quality gate — the product's core promise. | Reviews submitted work; passes to client or returns. Paid per review. |
| **FINANCE** | Controls the money. The only role that can move funds. | Releases payouts, refunds clients, resolves disputes by refund, chases stuck payouts. |
| ~~ADMIN~~ / ~~SUPER_ADMIN~~ | **Not wired up.** | **No rule anywhere grants these anything.** See warning below. |

> ⚠️ **Do not assign ADMIN or SUPER_ADMIN to anyone.** They exist as leftovers in
> the role list, but no policy or function references them. Someone given ADMIN
> would see *less* than a client — they'd be locked out of their own orders. Use
> the six working roles only.

---

## 2. The queue principle

**A staff member sees exactly the orders they can act on right now — and each
order leaves their view the moment they act.**

Sales sees orders awaiting a quote. Ops sees orders waiting to be assigned, sent
to QC, delivered or closed. QC sees orders in review. Finance sees closed orders
awaiting payout.

This means the staff console is **a to-do list, not a database browser**. An
empty queue genuinely means there is nothing for that role to do. It also means
staff cannot browse the whole business: an Ops person cannot go looking through
finished orders, and a Sales person cannot see work in production.

QC is the one exception, with a small extension: a reviewer keeps sight of the
orders they personally reviewed, so they can see outcomes and verify their own
payout.

---

## 3. Role playbooks

### CLIENT — the paying customer
`/orders` · `/dashboard`

Everyone who signs up becomes a client automatically. They see only their own orders.

**Can do**

| Action | Transition | Notes |
|---|---|---|
| Create an order | → `DRAFT` | A private draft. |
| Submit for a quote | `DRAFT → SUBMITTED` | Now visible to Sales only. |
| Pay the quote | `QUOTED → PAYMENT_HELD` | Opens Razorpay checkout. Funds only on the signed confirmation. |
| Message the designer | — | Other side labelled "Designer". |
| Approve the preview | `CLIENT_PREVIEW → APPROVED` | Accepts QC-passed work. |
| Request a revision | → `REVISION_REQUESTED` | Sends back to the designer. |
| Close the order | `DELIVERED → CLOSED` | Makes it payable. |
| Raise a dispute | → `DISPUTED` | Requires a written reason. |
| Cancel | from `DRAFT`/`SUBMITTED`/`QUOTED` | Only before paying. |

**Cannot do:** mark their own order paid · see who the designer is · see any
other client's orders · cancel after paying (that becomes a Finance refund).

---

### DESIGNER — produces the work
`/orders` · `/settings/payouts`

Must be `ACTIVE` with the current agreement signed before work can reach them.

**Can do**

| Action | Transition | Notes |
|---|---|---|
| Start work | `ASSIGNED → IN_PROGRESS` | Accepts the assignment. |
| Upload deliverables | — | Files auto-stripped of identifying metadata. |
| Submit for review | → `DESIGNER_SUBMITTED` | Hands to Ops for QC intake. |
| Rework a revision | `REVISION_REQUESTED → IN_PROGRESS` | After QC or client returns it. |
| Message the client | — | Labelled "Client". No names, ever. |
| Add payout details | `/settings/payouts` | Bank, IFSC, PAN. Required before payment. |
| See their payouts | — | Amount, state, date — no processor internals. |

**Cannot do:** see the client's company/name/contact · see what the client was
charged · see other designers' work or rates · read back their own full bank
number or PAN (only last four) · receive work while `PENDING`, suspended, or
with an unsigned current agreement.

> **Changing bank details resets verification.** An edited account drops back to
> unverified and must be re-linked before the next payout — a deliberate guard
> against a hijacked account redirecting earnings.

---

### SALES — prices the work
`/admin` · `/admin/leads` · `/admin/applications`

**Can do**

| Action | Transition | Notes |
|---|---|---|
| Quote an order | `SUBMITTED → QUOTED` | Total, designer payout, QC payout, commission. **The parts must sum exactly to the total** or it's refused. |
| Work the contact inbox | — | Website enquiries; mark handled. |
| Review designer applications | — | Accept/decline with a note; applicant emailed either way. |

**Cannot do:** re-quote after the client has paid · see orders once quoted (they
leave the queue) · assign designers, review work, or move money.

> **The quote is the single most consequential business decision in the system.**
> It sets what the designer earns, what QC earns, and what you keep —
> permanently, for that order. **There is no re-quote path.**

---

### OPS — runs the pipeline
`/admin` · `/admin/applications` · `/admin/leads`

The busiest staff role; Ops touches every order at four points.

**Can do**

| Action | Transition | Notes |
|---|---|---|
| Assign a designer | `PAYMENT_HELD → ASSIGNED` | Only to an assignable designer; refuses the order's own QC reviewer. |
| Send work to QC | `DESIGNER_SUBMITTED → QC_REVIEW` | Puts it in the reviewer pool. |
| Deliver | `APPROVED → DELIVERED` | Final files to the client. |
| Close an order | `DELIVERED → CLOSED` | If the client doesn't. |
| Resolve a dispute by rework | `DISPUTED → IN_PROGRESS` | Instead of refunding. |
| Review applications and leads | — | Same inboxes as Sales. |

**Cannot do:** move any money · pass or fail QC · assign an order to its own
reviewer · change a quote.

---

### QC — the independent gate
`/admin` · `/orders`

Reviewers are a pool, not pre-assigned. Identity is recorded at decision time.

**Can do**

| Action | Transition | Notes |
|---|---|---|
| Pass the work | `QC_REVIEW → CLIENT_PREVIEW` | Recorded on the client's timeline as an independent review. |
| Request a revision | `QC_REVIEW → REVISION_REQUESTED` | Back to the designer, decision recorded. |
| Track their reviews | — | Keeps visibility of orders they reviewed, to verify their payout. |

**Cannot do:** review work they produced (refused outright) · review an order
they placed as a client · see orders outside review, beyond ones they reviewed.

> This role carries the product's central claim. "Checked by someone who didn't
> make it" is enforced in the database — a reviewer who tries to pass their own
> work gets an error, not a warning.

---

### FINANCE — controls the money
`/admin` · `/orders`

**Can do**

| Action | Transition | Notes |
|---|---|---|
| Release the payout | `CLOSED → PAYOUT_RELEASED` | Splits escrow three ways. Refused if any payee lacks a verified account. |
| Send the payouts | — | Turns obligations into real bank transfers, from the order's payout panel. |
| Check stuck payouts | — | Asks the processor what happened to anything in flight. |
| Refund a client | `PAYMENT_HELD → REFUNDED` | Full or partial; partial leaves the order running. |
| Resolve a dispute by refund | `DISPUTED → REFUNDED` | Ops handles the rework outcome. |

**Cannot do:** release before `CLOSED` · release more or less than is held · pay
anyone without a verified payout account · edit or delete any past money record.

---

## 4. Setting your team up

Everyone who signs up becomes a **Client**. Designers convert themselves by
applying in-app. **Staff roles have no user interface.**

> ⚠️ **There is no "make this person Ops" button.** Staff roles are assigned with
> SQL in the Supabase SQL editor. Treat access to that editor as the real admin
> permission in your business, and keep it to yourself.

### Give someone a staff role

Have them sign in once first — that creates their user row.

```sql
-- 1. find them (the id is their sign-in identity)
SELECT id, role, status FROM users ORDER BY created_at DESC LIMIT 20;

-- 2. set the role: SALES | OPS | QC | FINANCE
UPDATE users SET role = 'OPS', status = 'ACTIVE' WHERE id = 'user_xxx';
```

They see the new console on their next page load. To remove access, set the role
back to `CLIENT`, or `status = 'SUSPENDED'` to freeze the account entirely.

### Take a designer live

Accept their application in `/admin/applications` → they sign up and apply
in-app → they sign the agreement (`ACTIVE`) → they add payout details → you link
their bank account:

```bash
npm run payouts:link -- --list
npm run payouts:link -- --user <users.id> --account-ref acc_xxx
```

Only after that final step can any payout for them be released.

---

## 5. When something goes wrong

**A client says they paid, but the order still shows unpaid.**
The payment reached Razorpay but the confirmation didn't reach you — almost
always the webhook. Check the Razorpay dashboard for the payment, then webhook
deliveries for failures. Confirm the URL and secret still match. Once
redelivered the order funds itself; duplicates are safe.

**Finance can't release a payout.**
The error names the reason. Usually: the order isn't `CLOSED` yet → close it; no
QC reviewer recorded → it never went through review; a payee has no verified
account → link them, then retry.

**A payout is stuck "on its way".**
Open the order as Finance and press **Check stuck payouts**. It asks the
processor what actually happened: if the transfer exists it adopts that outcome,
if it never existed it becomes retryable. Safe any time; cannot double-pay.

**A payout failed.**
Usually a mismatch between the designer's name at the bank and their account. Ask
them to re-enter details exactly as the bank holds them — that resets the account
to unverified, so re-link it. *The designer is not emailed on failure today, so
tell them.*

**A client raises a dispute.**
The order freezes with a written reason. Money stays in escrow. **Ops** sends it
back for rework if fixable; **Finance** refunds if not. Both outcomes recorded.

**An applicant never got their email.**
The email is queued and safe — only sending failed. Drain the queue:

```bash
npm run send-emails
```

Nothing is lost and nothing sends twice.

**You need to contact a client or designer.**
You can't look them up in the app — **no screen anywhere shows a client's or
designer's name or email, including for staff.** That's the anonymity model
working. Query `client_profiles` / `designer_profiles` directly, or use the
contact-lead and application inboxes, which do carry details people submitted.

**You need to check whether the site is healthy.**
Visit `/api/health`. It reports which configuration groups are present — never
the values. Anything other than `ok` names the missing group.

---

## 6. Known limits to work around

| Limit | Workaround |
|---|---|
| No role management screen | Supabase SQL editor (§4). |
| No name lookup for staff | Query the profile tables directly when genuinely needed. |
| Payout linking is manual | Fine for the first dozen designers; automate when it hurts. |
| Nothing runs on a timer | Run the commands above, or add a cron job. |
| No failure email to designers | Message them directly. |
| Accepted ≠ onboarded | Follow up by email; they self-serve from there. |
| No admin search or paging | Fine at low volume; revisit as it grows. |
| QC reviewers get no payout email | They have no profile email; they can see status in-app. |

---

## 7. An operating rhythm

**Every day (~15 min)**
- Work the **Sales** queue — every unquoted order is a customer waiting.
- Work the **Ops** queue — assign, send to QC, deliver.
- Clear **QC review** — the slowest thing to let pile up.
- Check `/admin/applications` and `/admin/leads` for new arrivals.

**Every week (~30 min)**
- Release payouts on all `CLOSED` orders.
- Run **Check stuck payouts** once, even if nothing looks wrong.
- Drain the email queue as a safety net.
- Skim `/api/health`.

**Every month (~1 hr)**
- Reconcile the platform's take against your Razorpay settlements.
- Review designers who haven't worked recently.
- Confirm no disputes are lingering unresolved.
- Confirm every active designer's bank account is still verified.

---

*Every permission, refusal and limit above was read from the live schema — the
role gates on each transition, the row-level rules on each table, and the
absence of any rule for ADMIN/SUPER_ADMIN.*
