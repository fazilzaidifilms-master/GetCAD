"use client";

import { useRef, useState } from "react";

import { crowdedPairs, pinFromTap, pinProblems, pinStyle, type Pin } from "@/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { setPinsAction } from "./referenceActions";

/**
 * One reference picture, with pins you place by tapping it.
 *
 * THE INTERACTION. Tap the image to drop a pin, then say what it points at.
 * Not drag-to-place: on a phone a drag competes with scrolling the page, and
 * the gesture that wins is decided by a few pixels of finger movement. A tap is
 * unambiguous, and a misplaced pin is corrected by removing it and tapping
 * again — which costs less than a drag that fought the scroll.
 *
 * The pin appears immediately and the label is asked for afterwards, in that
 * order deliberately: people know where they mean before they know how to say
 * it, and making them name a thing before they can point at it is the version
 * of this form nobody finishes.
 *
 * Coordinates are basis points of the image, never pixels — see core/orders/pins.
 */
export function ReferencePinner({
  orderId,
  imageId,
  src,
  initialPins,
  isPrimary,
  readOnly = false,
}: {
  orderId: string;
  imageId: string;
  src: string;
  initialPins: Pin[];
  isPrimary: boolean;
  readOnly?: boolean;
}) {
  const [pins, setPins] = useState<Pin[]>(initialPins);
  const [active, setActive] = useState<number | null>(null);
  const imageRef = useRef<HTMLDivElement>(null);

  const problems = pinProblems(pins);
  const crowded = crowdedPairs(pins);

  function drop(event: React.MouseEvent<HTMLDivElement>) {
    if (readOnly) return;
    const rect = imageRef.current?.getBoundingClientRect();
    if (!rect) return;
    const { xBp, yBp } = pinFromTap(event.clientX, event.clientY, rect);
    setPins((p) => [...p, { xBp, yBp, label: "" }]);
    setActive(pins.length);
  }

  return (
    <form action={setPinsAction} className="rounded-[var(--r-lg)] border border-border bg-card p-3">
      <input type="hidden" name="order_id" value={orderId} />
      <input type="hidden" name="image_id" value={imageId} />

      <div className="mb-2 flex items-center justify-between">
        <span className="text-[length:var(--fs-2)] uppercase tracking-[var(--ls-1)] text-muted-foreground">
          {isPrimary ? "Main sketch" : "Reference"}
        </span>
        <span className="text-[length:var(--fs-2)] text-muted-foreground">
          {pins.length} pin{pins.length === 1 ? "" : "s"}
        </span>
      </div>

      <div
        ref={imageRef}
        onClick={drop}
        className={cn(
          "relative select-none overflow-hidden rounded-[var(--r-md)] border border-border",
          !readOnly && "cursor-crosshair",
        )}
      >
        {/* Plain <img>: the source is a short-lived signed URL from private
            storage, which the image optimiser cannot fetch and should not be
            caching at the edge anyway. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="Reference" className="block w-full" />

        {pins.map((pin, i) => (
          <span
            key={i}
            style={pinStyle(pin)}
            className={cn(
              "absolute -translate-x-1/2 -translate-y-1/2",
              "flex h-6 w-6 items-center justify-center rounded-full text-[length:var(--fs-1)] font-semibold",
              "ring-2 ring-background",
              pin.label.trim()
                ? "bg-primary text-primary-foreground"
                : // An unlabelled pin is the thing this feature exists to
                  // prevent, so it is visibly unfinished rather than merely
                  // rejected on save.
                  "bg-destructive text-destructive-foreground",
            )}
          >
            {i + 1}
          </span>
        ))}
      </div>

      {!readOnly ? (
        <p className="mt-2 text-[length:var(--fs-2)] text-muted-foreground">
          Tap the picture to drop a pin, then say what it points at.
        </p>
      ) : null}

      <ul className="mt-3 space-y-2">
        {pins.map((pin, i) => (
          <li key={i} className="flex items-center gap-2">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-[length:var(--fs-1)] font-semibold">
              {i + 1}
            </span>
            <input type="hidden" name="pin_x" value={pin.xBp} />
            <input type="hidden" name="pin_y" value={pin.yBp} />
            <Input
              name="pin_label"
              value={pin.label}
              autoFocus={active === i}
              readOnly={readOnly}
              placeholder="What is this pin pointing at?"
              onChange={(e) =>
                setPins((p) => p.map((q, j) => (j === i ? { ...q, label: e.target.value } : q)))
              }
              className="min-h-[var(--ctl)]"
            />
            {!readOnly ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`Remove pin ${i + 1}`}
                onClick={() => setPins((p) => p.filter((_, j) => j !== i))}
              >
                ✕
              </Button>
            ) : null}
          </li>
        ))}
      </ul>

      {problems.map((p) => (
        <p key={p} className="mt-2 text-[length:var(--fs-2)] text-destructive">
          {p}
        </p>
      ))}

      {crowded > 0 && problems.length === 0 ? (
        // Not an error: someone may legitimately mark the prong and the girdle
        // a millimetre apart. It just looks fine while placing and unreadable
        // afterwards.
        <p className="mt-2 text-[length:var(--fs-2)] text-muted-foreground">
          {crowded} pair{crowded === 1 ? "" : "s"} of pins sit almost on top of each other — the
          designer may not be able to tell which label is which.
        </p>
      ) : null}

      {!readOnly ? (
        <Button
          type="submit"
          variant="outline"
          className="mt-3 min-h-[var(--ctl)] w-full"
          disabled={problems.length > 0}
        >
          Save pins
        </Button>
      ) : null}
    </form>
  );
}
