"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signup, type AuthState } from "@/lib/actions/auth";
import { useLang } from "@/components/language-provider";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const todayIso = () => {
  const now = new Date();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${m}-${d}`;
};

export function SignupForm() {
  const { t } = useLang();
  const [state, action, pending] = useActionState<AuthState, FormData>(
    signup,
    undefined,
  );

  return (
    <form action={action} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="email">{t("auth.email")}</Label>
        <Input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          autoFocus
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password">{t("auth.password")}</Label>
        <Input
          id="password"
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
        />
        <p className="text-xs text-faint">{t("auth.passwordHint")}</p>
      </div>

      <fieldset className="space-y-3 rounded-xl border border-border p-3" disabled={pending}>
        <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted">
          {t("signup.pharmacyDetails")}
        </legend>
        <div className="space-y-1.5">
          <Label htmlFor="full_name">{t("signup.yourName")}</Label>
          <Input
            id="full_name"
            name="full_name"
            autoComplete="name"
            placeholder={t("signup.yourNamePlaceholder")}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pharmacy_name">{t("signup.pharmacyName")}</Label>
          <Input
            id="pharmacy_name"
            name="pharmacy_name"
            required
            autoComplete="organization"
            placeholder={t("signup.pharmacyNamePlaceholder")}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="license_no">{t("signup.licenseNo")}</Label>
            <Input id="license_no" name="license_no" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="license_expiry">{t("signup.licenseExpiry")}</Label>
            <Input
              id="license_expiry"
              name="license_expiry"
              type="date"
              required
              min={todayIso()}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="phone">{t("signup.phone")}</Label>
          <Input
            id="phone"
            name="phone"
            type="tel"
            autoComplete="tel"
            placeholder={t("signup.phonePlaceholder")}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="address">{t("signup.address")}</Label>
          <Input
            id="address"
            name="address"
            autoComplete="street-address"
            placeholder={t("signup.addressPlaceholder")}
          />
        </div>
      </fieldset>

      {state?.error && (
        <p className="rounded-lg border border-danger/25 bg-danger-subtle px-3 py-2 text-sm text-danger-text">
          {state.error}
        </p>
      )}
      {state?.success && (
        <p className="rounded-lg border border-success/25 bg-success-subtle px-3 py-2 text-sm text-success-text">
          {state.success}
        </p>
      )}
      <Button type="submit" variant="primary" className="w-full" disabled={pending}>
        {pending ? t("auth.creatingAccount") : t("auth.createAccount")}
      </Button>
      <p className="text-center text-sm text-muted">
        {t("auth.haveAccount")}{" "}
        <Link href="/login" className="font-medium text-brand hover:underline">
          {t("auth.signIn")}
        </Link>
      </p>
    </form>
  );
}
