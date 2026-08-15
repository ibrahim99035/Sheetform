import { initObservability, captureError } from "@/lib/observability";

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    initObservability();
  }
}

export const onRequestError: import("next").Instrumentation.onRequestError = (
  err,
  request,
  context,
) => {
  captureError(err, {
    path: request.path,
    method: request.method,
    routePath: context.routePath,
    routeType: context.routeType,
  });
};