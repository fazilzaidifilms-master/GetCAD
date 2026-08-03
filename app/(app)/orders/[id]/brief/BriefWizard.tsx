"use client";

import { useMemo, useState } from "react";

import {
  estimateMct,
  formatCarat,
  gradeBrief,
  micronsToMm,
  mmToMicrons,
  qualitySummary,
  type BriefGap,
  type OrderSpecInput,
} from "@/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import { saveBriefAction } from "./actions";

/**
 * The brief, as a form.
 *
 * TWO DECISIONS WORTH KNOWING ABOUT.
 *
 * First, it is ONE form element across all the steps, with the inactive steps
 * hidden rather than unmounted. Stepping is a reading aid, not a submission
 * boundary — so the whole brief posts at once, "back" costs nothing, and a
 * field answered on step 2 cannot be silently dropped because the user never
 * returned to it. It also means the form works with JavaScript off, which is
 * not a hypothetical on a phone with a bad connection.
 *
 * Second, the quality panel grades as you type, and grades ambiguity rather
 * than completeness. "Every field is filled" and "a designer can build this"
 * are different claims, and only the second one is worth telling somebody.
 */
const PRODUCTS = ["RING", "PENDANT", "EARRING", "BRACELET", "BANGLE", "BROOCH", "OTHER"];
const SHAPES = [
  "ROUND", "OVAL", "CUSHION", "PRINCESS", "EMERALD", "PEAR", "MARQUISE",
  "RADIANT", "ASSCHER", "HEART", "TRILLION", "BAGUETTE", "OTHER",
];
const SETTINGS = ["PRONG_4", "PRONG_6", "BEZEL", "HALO", "PAVE", "CHANNEL", "TENSION", "FLUSH", "OTHER"];
const METALS = ["YELLOW", "WHITE", "ROSE", "TWO_TONE", "TRI_COLOUR", "PLATINUM", "SILVER"];
const PURPOSES: Array<[string, string]> = [
  ["CASTING", "Cast in metal — the thickest walls, and the usual answer"],
  ["DIRECT_PRINT", "Printed directly — tolerates thinner walls"],
  ["RENDER_ONLY", "Images only — never physically made"],
];
const FORMATS = ["THREE_DM", "STL", "BOTH", "STEP"];
const FINISHES = ["HIGH_POLISH", "MATTE", "BRUSHED", "HAMMERED", "MIXED"];
const SUPPLY = ["NONE", "CLIENT", "DESIGNER", "PLATFORM"];
const PRIORITIES = ["STANDARD", "EXPRESS", "RUSH"];

const label = (v: string) =>
  v.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

/**
 * Millimetres as typed -> microns as stored. Module-level rather than a closure
 * over `form`, so the memos below depend on the form object itself and nothing
 * that is re-created on every render.
 */
function micronsFrom(form: Record<string, string>, key: string): number | null {
  const raw = form[key];
  const value = Number(raw);
  return raw && Number.isFinite(value) && value > 0 ? mmToMicrons(value) : null;
}

export interface AccentRow {
  shape: string;
  widthMm: string;
  quantity: string;
  setting: string;
}

export interface BriefDefaults extends Partial<OrderSpecInput> {
  accents?: AccentRow[];
}

const STEPS = ["Your reference", "The piece", "Centre stone", "Accent stones", "Material & output"];

export function BriefWizard({
  orderId,
  defaults,
  readOnly = false,
  referenceImageCount = 0,
  pinnedImageCount = 0,
}: {
  orderId: string;
  defaults: BriefDefaults;
  /** True once the order has been quoted — the brief is frozen from then on. */
  readOnly?: boolean;
  referenceImageCount?: number;
  pinnedImageCount?: number;
}) {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<Record<string, string>>({
    reference_name: defaults.referenceName ?? "",
    product: defaults.product ?? "RING",
    metal: defaults.metal ?? "YELLOW",
    karatage: defaults.karatage ?? "18K",
    purpose: defaults.purpose ?? "CASTING",
    format: defaults.format ?? "BOTH",
    finish: defaults.finish ?? "HIGH_POLISH",
    centre_shape: defaults.centreShape ?? "ROUND",
    centre_setting: defaults.centreSetting ?? "PRONG_6",
    centre_quantity: String(defaults.centreQuantity ?? 1),
    centre_length_mm: defaults.centreLengthUm ? String(micronsToMm(defaults.centreLengthUm)) : "",
    centre_width_mm: defaults.centreWidthUm ? String(micronsToMm(defaults.centreWidthUm)) : "",
    centre_depth_mm: defaults.centreDepthUm ? String(micronsToMm(defaults.centreDepthUm)) : "",
    stones_supplied_by: "NONE",
    component_count: "1",
    render_views: "0",
    priority: "STANDARD",
    notes: "",
  });
  const [hasCentre, setHasCentre] = useState(defaults.hasCentreStone ?? false);
  const [certified, setCertified] = useState(false);
  const [accents, setAccents] = useState<AccentRow[]>(defaults.accents ?? []);

  const set = (key: string) => (value: string) => setForm((f) => ({ ...f, [key]: value }));
  const mm = (key: string) => micronsFrom(form, key);

  // Graded on every keystroke. Cheap — it is pure arithmetic over one object.
  const quality = useMemo(() => {
    const spec: OrderSpecInput = {
      referenceName: form.reference_name ?? "",
      product: form.product ?? "",
      metal: form.metal ?? "",
      karatage: form.karatage ?? "",
      purpose: form.purpose ?? "",
      format: form.format ?? "",
      finish: form.finish ?? "",
      hasCentreStone: hasCentre,
      centreShape: hasCentre ? form.centre_shape : null,
      centreSetting: hasCentre ? form.centre_setting : null,
      centreQuantity: hasCentre ? Number(form.centre_quantity) || 0 : 0,
      centreLengthUm: hasCentre ? micronsFrom(form, "centre_length_mm") : null,
      centreWidthUm: hasCentre ? micronsFrom(form, "centre_width_mm") : null,
      centreDepthUm: hasCentre ? micronsFrom(form, "centre_depth_mm") : null,
      centreCertified: certified,
    };
    return gradeBrief(spec, {
      accentRowCount: accents.length,
      referenceImageCount,
      pinnedImageCount,
    });
  }, [form, hasCentre, certified, accents.length, referenceImageCount, pinnedImageCount]);

  // "Answer whichever you have, we work out the other" — shown, never stored,
  // so it can never overwrite a certified stone's real weight.
  const estimatedCarat = useMemo(() => {
    if (!hasCentre) return null;
    const mct = estimateMct(
      form.centre_shape ?? "",
      micronsFrom(form, "centre_length_mm"),
      micronsFrom(form, "centre_width_mm"),
      micronsFrom(form, "centre_depth_mm"),
    );
    return mct === null ? null : formatCarat(mct);
  }, [form, hasCentre]);

  if (readOnly) {
    return (
      <div className="rounded-[var(--r-lg)] border border-border bg-card p-4">
        <p className="text-[length:var(--fs-3)] text-muted-foreground">
          This brief is fixed — the order has been quoted against it. To change the work, start a
          new order based on this one.
        </p>
      </div>
    );
  }

  return (
    <form action={saveBriefAction} className="pb-4">
      <input type="hidden" name="order_id" value={orderId} />
      {/* Millimetres are what people type; microns are what the database
          stores. Converted once, here, at the boundary. */}
      <input type="hidden" name="centre_length_um" value={mm("centre_length_mm") ?? ""} />
      <input type="hidden" name="centre_width_um" value={mm("centre_width_mm") ?? ""} />
      <input type="hidden" name="centre_depth_um" value={mm("centre_depth_mm") ?? ""} />

      <StepBar step={step} onPick={setStep} />

      <Pane show={step === 0}>
        <Field
          id="reference_name"
          label="Name this job"
          hint="Only you see this name. It is how the order shows in your list."
        >
          <Input
            id="reference_name"
            name="reference_name"
            value={form.reference_name}
            onChange={(e) => set("reference_name")(e.target.value)}
            placeholder="Anniversary band"
            className="min-h-[var(--ctl)]"
          />
        </Field>
      </Pane>

      <Pane show={step === 1}>
        <Choice
          name="product"
          legend="What are we modelling?"
          hint="This decides which measurements you are asked for."
          options={PRODUCTS.map((v) => [v, label(v)])}
          value={form.product ?? ""}
          onChange={set("product")}
        />
      </Pane>

      <Pane show={step === 2}>
        <Toggle
          name="has_centre_stone"
          checked={hasCentre}
          onChange={setHasCentre}
          label="Is there a stone at the centre?"
          hint="Everything about the head follows from this answer."
        />

        {hasCentre ? (
          <>
            <Choice
              name="centre_shape"
              legend="Shape"
              hint="The seat is cut to this outline."
              options={SHAPES.map((v) => [v, label(v)])}
              value={form.centre_shape ?? ""}
              onChange={set("centre_shape")}
            />

            <div className="mt-4 grid grid-cols-3 gap-2">
              {(["centre_length_mm", "centre_width_mm", "centre_depth_mm"] as const).map((k, i) => (
                <Field key={k} id={k} label={["Length", "Width", "Depth"][i] + " (mm)"}>
                  <Input
                    id={k}
                    inputMode="decimal"
                    value={form[k]}
                    onChange={(e) => set(k)(e.target.value)}
                    placeholder="6.50"
                    className="min-h-[var(--ctl)]"
                  />
                </Field>
              ))}
            </div>

            {estimatedCarat ? (
              <p className="mt-2 text-[length:var(--fs-2)] text-muted-foreground">
                Roughly <span className="tabular font-medium">{estimatedCarat}</span> — an estimate
                from the dimensions, not stored. A certificate is the authority.
              </p>
            ) : null}

            <Toggle
              name="centre_certified"
              checked={certified}
              onChange={setCertified}
              label="This stone is certified"
              hint="Its dimensions are fixed, so the seat is cut with no tolerance either way."
            />

            <Field id="centre_quantity" label="How many of this stone">
              <Input
                id="centre_quantity"
                name="centre_quantity"
                inputMode="numeric"
                value={form.centre_quantity}
                onChange={(e) => set("centre_quantity")(e.target.value)}
                className="min-h-[var(--ctl)]"
              />
            </Field>

            <Choice
              name="centre_setting"
              legend="How is it held?"
              hint="A four-prong and a six-prong head are two different builds."
              options={SETTINGS.map((v) => [v, label(v)])}
              value={form.centre_setting ?? ""}
              onChange={set("centre_setting")}
            />
          </>
        ) : (
          <p className="mt-3 text-[length:var(--fs-3)] text-muted-foreground">
            No centre stone. The head questions are gone — go straight to accents.
          </p>
        )}
      </Pane>

      <Pane show={step === 3}>
        <p className="text-[length:var(--fs-3)] text-muted-foreground">
          One row per group of stones sharing a size and a setting — eighteen 1.30&nbsp;mm rounds
          pavé set is one row, not eighteen.
        </p>

        {accents.map((row, i) => (
          <div
            key={i}
            className="mt-3 rounded-[var(--r-md)] border border-border p-3"
          >
            <div className="flex items-center justify-between">
              <span className="text-[length:var(--fs-2)] uppercase tracking-[var(--ls-1)] text-muted-foreground">
                Row {i + 1}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setAccents((a) => a.filter((_, j) => j !== i))}
              >
                Remove
              </Button>
            </div>
            <input type="hidden" name="accent_shape" value={row.shape} />
            <input type="hidden" name="accent_setting" value={row.setting} />
            <input
              type="hidden"
              name="accent_width_um"
              value={row.widthMm ? mmToMicrons(Number(row.widthMm) || 0) : 0}
            />
            <input type="hidden" name="accent_quantity" value={Number(row.quantity) || 0} />

            <div className="mt-2 grid grid-cols-2 gap-2">
              <Select
                label="Shape"
                options={SHAPES.map((v) => [v, label(v)])}
                value={row.shape}
                onChange={(v) => updateAccent(setAccents, i, { shape: v })}
              />
              <Select
                label="Setting"
                options={SETTINGS.map((v) => [v, label(v)])}
                value={row.setting}
                onChange={(v) => updateAccent(setAccents, i, { setting: v })}
              />
              <Field id={`aw${i}`} label="Width (mm)">
                <Input
                  id={`aw${i}`}
                  inputMode="decimal"
                  value={row.widthMm}
                  onChange={(e) => updateAccent(setAccents, i, { widthMm: e.target.value })}
                  placeholder="1.30"
                  className="min-h-[var(--ctl)]"
                />
              </Field>
              <Field id={`aq${i}`} label="How many">
                <Input
                  id={`aq${i}`}
                  inputMode="numeric"
                  value={row.quantity}
                  onChange={(e) => updateAccent(setAccents, i, { quantity: e.target.value })}
                  placeholder="18"
                  className="min-h-[var(--ctl)]"
                />
              </Field>
            </div>
          </div>
        ))}

        <Button
          type="button"
          variant="outline"
          className="mt-3 min-h-[var(--ctl)] w-full"
          onClick={() =>
            setAccents((a) => [
              ...a,
              { shape: "ROUND", widthMm: "", quantity: "", setting: "PAVE" },
            ])
          }
        >
          {accents.length === 0 ? "Add the first row" : "Another row"}
        </Button>

        <Choice
          name="stones_supplied_by"
          legend="Who supplies the stones?"
          hint="Stones never move through this platform. This sets how much tolerance the designer leaves."
          options={SUPPLY.map((v) => [v, v === "NONE" ? "No stones" : label(v)])}
          value={form.stones_supplied_by ?? ""}
          onChange={set("stones_supplied_by")}
        />
      </Pane>

      <Pane show={step === 4}>
        <Choice
          name="metal"
          legend="Metal colour"
          options={METALS.map((v) => [v, label(v)])}
          value={form.metal ?? ""}
          onChange={set("metal")}
        />

        <Field id="karatage" label="Karatage / alloy">
          <Input
            id="karatage"
            name="karatage"
            value={form.karatage}
            onChange={(e) => set("karatage")(e.target.value)}
            placeholder="18K"
            className="min-h-[var(--ctl)]"
          />
        </Field>

        <Choice
          name="purpose"
          legend="What is the CAD for?"
          hint="This sets the minimum wall thickness the designer must hold. It is the most expensive thing in the brief to get wrong."
          options={PURPOSES}
          value={form.purpose ?? ""}
          onChange={set("purpose")}
        />

        <Choice
          name="format"
          legend="Output format"
          options={FORMATS.map((v) => [v, v === "THREE_DM" ? "3DM" : label(v)])}
          value={form.format ?? ""}
          onChange={set("format")}
        />

        <Choice
          name="finish"
          legend="Finish"
          options={FINISHES.map((v) => [v, label(v)])}
          value={form.finish ?? ""}
          onChange={set("finish")}
        />

        <Choice
          name="priority"
          legend="Priority"
          options={PRIORITIES.map((v) => [v, label(v)])}
          value={form.priority ?? ""}
          onChange={set("priority")}
        />

        <Field
          id="notes"
          label="Anything else"
          hint="The place for what the fields above cannot hold — which parts are which metal, how stones are arranged, where a mixed finish falls."
        >
          <Textarea
            id="notes"
            name="notes"
            rows={4}
            value={form.notes}
            onChange={(e) => set("notes")(e.target.value)}
          />
        </Field>

        <input type="hidden" name="component_count" value={form.component_count} />
        <input type="hidden" name="render_views" value={form.render_views} />
      </Pane>

      <QualityPanel quality={quality} onJump={(field) => setStep(stepForField(field))} />

      <div className="sticky bottom-0 mt-4 flex gap-2 border-t border-border bg-background/95 py-3 backdrop-blur">
        <Button
          type="button"
          variant="ghost"
          className="min-h-[var(--ctl)]"
          disabled={step === 0}
          onClick={() => setStep((s) => Math.max(0, s - 1))}
        >
          Back
        </Button>
        {step < STEPS.length - 1 ? (
          <Button
            type="button"
            className="min-h-[var(--ctl)] flex-1"
            onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
          >
            Next
          </Button>
        ) : null}
        {/* Saving is always available, from any step: a partly-finished brief is
            worth keeping, and the database decides what is complete enough. */}
        <Button type="submit" variant={step === STEPS.length - 1 ? "default" : "outline"} className="min-h-[var(--ctl)] flex-1">
          Save brief
        </Button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------ subcomponents */

function updateAccent(
  setAccents: React.Dispatch<React.SetStateAction<AccentRow[]>>,
  index: number,
  patch: Partial<AccentRow>,
) {
  setAccents((rows) => rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
}

/** Which step to jump to when someone taps a gap in the quality panel. */
function stepForField(field: string): number {
  if (field === "referenceName") return 0;
  if (field === "product") return 1;
  if (field.startsWith("centre")) return 2;
  if (field === "references") return 3;
  return 4;
}

function StepBar({ step, onPick }: { step: number; onPick: (n: number) => void }) {
  return (
    <div className="mb-5">
      <p className="text-[length:var(--fs-2)] uppercase tracking-[var(--ls-1)] text-muted-foreground">
        Step {step + 1} of {STEPS.length}
      </p>
      <h2 className="mt-0.5 text-[length:var(--fs-5)] font-semibold leading-[var(--lh-5)] tracking-[var(--ls-5)]">
        {STEPS[step]}
      </h2>
      <div className="mt-3 flex gap-1" role="tablist" aria-label="Brief steps">
        {STEPS.map((s, i) => (
          <button
            key={s}
            type="button"
            role="tab"
            aria-selected={i === step}
            aria-label={s}
            onClick={() => onPick(i)}
            className={cn(
              "h-1 flex-1 rounded-[var(--r-full)] transition-colors duration-[var(--dur-fast)]",
              i <= step ? "bg-primary" : "bg-muted",
            )}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Hidden, not unmounted. Unmounting would drop the inputs from the form, so a
 * field answered on step 2 would silently not be submitted from step 5.
 */
function Pane({ show, children }: { show: boolean; children: React.ReactNode }) {
  return <div hidden={!show}>{children}</div>;
}

function Field({
  id,
  label: text,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-4">
      <Label htmlFor={id}>{text}</Label>
      {hint ? (
        <p className="mb-1.5 mt-0.5 text-[length:var(--fs-2)] text-muted-foreground">{hint}</p>
      ) : (
        <div className="mb-1.5" />
      )}
      {children}
    </div>
  );
}

/**
 * Radio group rendered as tappable cards.
 *
 * A native `<select>` on a phone opens a wheel that hides the question and
 * shows one option at a time — bad wherever the choice carries a consequence
 * the person is supposed to weigh, which here is most of them.
 */
function Choice({
  name,
  legend,
  hint,
  options,
  value,
  onChange,
}: {
  name: string;
  legend: string;
  hint?: string;
  options: Array<[string, string]>;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <fieldset className="mt-5">
      <legend className="text-[length:var(--fs-4)] font-medium">{legend}</legend>
      {hint ? (
        <p className="mt-0.5 text-[length:var(--fs-2)] text-muted-foreground">{hint}</p>
      ) : null}
      <div className="mt-2 grid grid-cols-2 gap-2">
        {options.map(([v, text]) => (
          <label
            key={v}
            className={cn(
              "flex min-h-[var(--ctl)] cursor-pointer items-center rounded-[var(--r-md)] border px-3 py-2",
              "text-[length:var(--fs-3)] transition-colors duration-[var(--dur-fast)]",
              value === v
                ? "border-primary bg-[var(--accent-quiet)] font-medium"
                : "border-border hover:bg-accent",
            )}
          >
            <input
              type="radio"
              name={name}
              value={v}
              checked={value === v}
              onChange={() => onChange(v)}
              className="sr-only"
            />
            {text}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function Select({
  label: text,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Array<[string, string]>;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="mt-4">
      <Label>{text}</Label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1.5 min-h-[var(--ctl)] w-full rounded-[var(--r-md)] border border-input bg-background px-3 text-[length:var(--fs-3)]"
      >
        {options.map(([v, t]) => (
          <option key={v} value={v}>
            {t}
          </option>
        ))}
      </select>
    </div>
  );
}

function Toggle({
  name,
  checked,
  onChange,
  label: text,
  hint,
}: {
  name: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="mt-5 flex min-h-[var(--ctl)] cursor-pointer items-start gap-3">
      <input
        type="checkbox"
        name={name}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 h-4 w-4"
      />
      <span>
        <span className="text-[length:var(--fs-4)] font-medium">{text}</span>
        {hint ? (
          <span className="mt-0.5 block text-[length:var(--fs-2)] text-muted-foreground">
            {hint}
          </span>
        ) : null}
      </span>
    </label>
  );
}

/**
 * The grade, and what a designer still could not work out.
 *
 * Deliberately not a progress bar over filled fields. A brief can have every
 * field answered and still not say how wide the stone is, and telling somebody
 * they are at 100% in that state is worse than saying nothing.
 */
function QualityPanel({
  quality,
  onJump,
}: {
  quality: ReturnType<typeof gradeBrief>;
  onJump: (field: string) => void;
}) {
  const tone =
    quality.grade === "Incomplete"
      ? "text-destructive"
      : quality.grade === "Excellent"
        ? "text-emerald-600 dark:text-emerald-400"
        : "text-foreground";

  return (
    <section className="mt-8 rounded-[var(--r-lg)] border border-border bg-card p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[length:var(--fs-4)] font-medium">Brief quality</h3>
        <span className={cn("tabular text-[length:var(--fs-5)] font-semibold", tone)}>
          {quality.grade}
        </span>
      </div>

      <div className="mt-2 h-1.5 overflow-hidden rounded-[var(--r-full)] bg-muted">
        <div
          className="h-full bg-primary transition-[width] duration-[var(--dur-base)] ease-[var(--ease-out)]"
          style={{ width: `${quality.score}%` }}
        />
      </div>

      <p className="mt-2 text-[length:var(--fs-3)] text-muted-foreground">
        {qualitySummary(quality)}
      </p>

      {quality.gaps.length > 0 ? (
        <>
          <h4 className="mt-4 text-[length:var(--fs-2)] uppercase tracking-[var(--ls-1)] text-muted-foreground">
            What a designer still cannot determine
          </h4>
          <ul className="mt-2 space-y-3">
            {quality.gaps.map((g: BriefGap, i) => (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => onJump(g.field)}
                  className="block w-full text-left"
                >
                  <span className="text-[length:var(--fs-3)] font-medium">
                    {g.what}
                    {g.severity === "blocking" ? (
                      <span className="ml-2 text-destructive">required</span>
                    ) : null}
                  </span>
                  <span className="mt-0.5 block text-[length:var(--fs-2)] text-muted-foreground">
                    {g.why}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
