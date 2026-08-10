"use client";

import { useActionState } from "react";
import Link from "next/link";
import { login, type AuthState } from "@/lib/actions/auth";

export function LoginForm() {
  const [state, action, pending] = useActionState<AuthState, FormData>(
    login,
    undefined,
  );

  return (
    <form action={action} className="space-y-4">
      <div>
        <label htmlFor="email" className="mb-1 block text-sm font-medium text-neutral-700">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500 focus:ring-2 focus:ring-neutral-200"
        />
      </div>
      <div>
        <label htmlFor="password" className="mb-1 block text-sm font-medium text-neutral-700">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500 focus:ring-2 focus:ring-neutral-200"
        />
      </div>
      {state?.error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-800 disabled:opacity-60"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
      <p className="text-center text-sm text-neutral-500">
        No account?{" "}
        <Link href="/signup" className="font-medium text-neutral-900 hover:underline">
          Create one
        </Link>
      </p>
    </form>
  );
}