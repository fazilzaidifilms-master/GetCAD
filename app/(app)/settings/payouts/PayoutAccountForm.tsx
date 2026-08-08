"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ACCOUNT_TYPES } from "@/core";
import {
  ACCOUNT_TYPE_LABELS,
  payoutAccountSchema,
  type PayoutAccountFields,
  type PayoutAccountInput,
} from "@/lib/validation/payoutAccount";

import { savePayoutAccountAction } from "./actions";

const selectCls =
  "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1.5 text-[length:var(--fs-3)] leading-[var(--lh-3)] shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background";

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="mt-1 text-[length:var(--fs-2)] leading-[var(--lh-2)] text-destructive">{message}</p>;
}

export function PayoutAccountForm({ hasExisting }: { hasExisting: boolean }) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<PayoutAccountInput, unknown, PayoutAccountFields>({
    resolver: zodResolver(payoutAccountSchema),
    defaultValues: { accountType: "SAVINGS" },
  });

  async function onValid(values: PayoutAccountFields) {
    setServerError(null);
    setSubmitting(true);

    const fd = new FormData();
    fd.set("beneficiaryName", values.beneficiaryName);
    fd.set("pan", values.pan);
    fd.set("accountNumber", values.accountNumber);
    fd.set("confirmAccountNumber", values.confirmAccountNumber);
    fd.set("ifsc", values.ifsc);
    fd.set("accountType", values.accountType);

    const result = await savePayoutAccountAction(fd);
    setSubmitting(false);

    if (!result.ok) {
      setServerError(result.error);
      return;
    }
    // Clear the fields immediately: there is no reason for a bank account
    // number to sit in a DOM input after it has been saved.
    reset({ accountType: "SAVINGS" });
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit(onValid)} noValidate className="space-y-4">
      <div>
        <Label htmlFor="beneficiaryName">Account holder name</Label>
        <Input
          id="beneficiaryName"
          autoComplete="off"
          placeholder="Exactly as it appears at your bank"
          {...register("beneficiaryName")}
        />
        <FieldError message={errors.beneficiaryName?.message} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="accountNumber">Bank account number</Label>
          <Input
            id="accountNumber"
            inputMode="numeric"
            autoComplete="off"
            spellCheck={false}
            {...register("accountNumber")}
          />
          <FieldError message={errors.accountNumber?.message} />
        </div>
        <div>
          <Label htmlFor="confirmAccountNumber">Confirm account number</Label>
          <Input
            id="confirmAccountNumber"
            inputMode="numeric"
            autoComplete="off"
            spellCheck={false}
            // Pasting defeats the point of a confirmation field.
            onPaste={(e) => e.preventDefault()}
            {...register("confirmAccountNumber")}
          />
          <FieldError message={errors.confirmAccountNumber?.message} />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="ifsc">IFSC</Label>
          <Input
            id="ifsc"
            autoComplete="off"
            spellCheck={false}
            placeholder="HDFC0001234"
            className="uppercase"
            {...register("ifsc")}
          />
          <FieldError message={errors.ifsc?.message} />
        </div>
        <div>
          <Label htmlFor="accountType">Account type</Label>
          <select id="accountType" className={selectCls} {...register("accountType")}>
            {ACCOUNT_TYPES.map((t) => (
              <option key={t} value={t}>
                {ACCOUNT_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
          <FieldError message={errors.accountType?.message} />
        </div>
      </div>

      <div>
        <Label htmlFor="pan">PAN</Label>
        <Input
          id="pan"
          autoComplete="off"
          spellCheck={false}
          placeholder="ABCDE1234F"
          className="uppercase"
          {...register("pan")}
        />
        <p className="mt-1 text-[length:var(--fs-2)] leading-[var(--lh-2)] text-muted-foreground">
          Required by our payment processor to send money to an Indian bank account.
        </p>
        <FieldError message={errors.pan?.message} />
      </div>

      {serverError && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-[length:var(--fs-3)] leading-[var(--lh-3)] text-destructive">
          {serverError}
        </div>
      )}

      <Button type="submit" disabled={submitting}>
        {submitting ? "Saving…" : hasExisting ? "Replace payout account" : "Save payout account"}
      </Button>

      {hasExisting && (
        <p className="text-[length:var(--fs-2)] leading-[var(--lh-2)] text-muted-foreground">
          Saving new details replaces the ones on file and sends them for verification again.
        </p>
      )}
    </form>
  );
}
