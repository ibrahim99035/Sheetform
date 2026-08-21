"use client";

import { useActionState } from "react";
import {
  updateEmail,
  updatePassword,
  updateDisplayName,
  type SettingsState,
} from "@/lib/actions/settings";
import { useLang } from "@/components/language-provider";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function FormMessage({ state }: { state: SettingsState }) {
  if (!state) return null;
  if (state.error) {
    return (
      <p className="rounded-lg border border-danger/25 bg-danger-subtle px-3 py-2 text-sm text-danger-text">
        {state.error}
      </p>
    );
  }
  if (state.success) {
    return (
      <p className="rounded-lg border border-success/25 bg-success-subtle px-3 py-2 text-sm text-success-text">
        {state.success}
      </p>
    );
  }
  return null;
}

export function SettingsForm({
  email,
  displayName,
}: {
  email: string;
  displayName: string;
}) {
  const { t } = useLang();
  const [emailState, emailAction, emailPending] = useActionState<SettingsState, FormData>(
    updateEmail,
    undefined,
  );
  const [pwState, pwAction, pwPending] = useActionState<SettingsState, FormData>(
    updatePassword,
    undefined,
  );
  const [nameState, nameAction, namePending] = useActionState<SettingsState, FormData>(
    updateDisplayName,
    undefined,
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Display name</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={nameAction} className="space-y-3">
            <div className="max-w-sm space-y-1.5">
              <Label htmlFor="display_name">Display name</Label>
              <Input
                id="display_name"
                name="display_name"
                type="text"
                defaultValue={displayName}
                autoComplete="name"
              />
            </div>
            <FormMessage state={nameState} />
            <Button type="submit" variant="secondary" size="sm" disabled={namePending}>
              {namePending ? t("settings.saving") : t("settings.save")}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Email</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={emailAction} className="space-y-3">
            <div className="max-w-sm space-y-1.5">
              <Label htmlFor="email">Email address</Label>
              <Input
                id="email"
                name="email"
                type="email"
                defaultValue={email}
                required
                autoComplete="email"
              />
            </div>
            <FormMessage state={emailState} />
            <Button type="submit" variant="secondary" size="sm" disabled={emailPending}>
              {emailPending ? "Updating…" : "Update email"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Change password</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={pwAction} className="space-y-3">
            <div className="max-w-sm space-y-1.5">
              <Label htmlFor="current_password">Current password</Label>
              <Input
                id="current_password"
                name="current_password"
                type="password"
                required
                autoComplete="current-password"
              />
            </div>
            <div className="max-w-sm space-y-1.5">
              <Label htmlFor="new_password">New password</Label>
              <Input
                id="new_password"
                name="new_password"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
              />
              <p className="text-xs text-faint">At least 8 characters.</p>
            </div>
            <div className="max-w-sm space-y-1.5">
              <Label htmlFor="confirm_password">Confirm new password</Label>
              <Input
                id="confirm_password"
                name="confirm_password"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
              />
            </div>
            <FormMessage state={pwState} />
            <Button type="submit" variant="secondary" size="sm" disabled={pwPending}>
              {pwPending ? "Updating…" : "Update password"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
