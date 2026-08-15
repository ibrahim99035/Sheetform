import * as Sentry from "@sentry/nextjs";
import { log } from "@/lib/log";

const DSN =
  process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN ?? null;

let initialized = false;

export function isObservabilityEnabled(): boolean {
  return DSN !== null;
}

/** Initializes Sentry once (node runtime). Safe to call with no DSN. */
export function initObservability(): void {
  if (initialized) return;
  initialized = true;

  if (!DSN) {
    log.warn("SENTRY_DSN not set; error reporting disabled");
    return;
  }

  Sentry.init({
    dsn: DSN,
    environment:
      process.env.SENTRY_ENVIRONMENT ??
      (process.env.NODE_ENV === "production" ? "production" : "development"),
    tracesSampleRate: 0.2,
  });
  log.info("Sentry initialized");
}

/** Logs the error and, when Sentry is configured, records it with context. */
export function captureError(
  err: unknown,
  ctx: { message?: string; [key: string]: unknown } = {},
): void {
  const error =
    err instanceof Error ? err : new Error(typeof err === "string" ? err : String(err));

  log.error(ctx.message ?? error.message, { ...ctx, detail: error.message });

  if (!DSN || !initialized) return;
  Sentry.withScope((scope) => {
    if (ctx.message) scope.setTag("message", ctx.message);
    for (const [key, value] of Object.entries(ctx)) {
      if (key !== "message") scope.setExtra(key, value);
    }
    Sentry.captureException(error);
  });
}