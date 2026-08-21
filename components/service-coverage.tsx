"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { BookOpen, CheckCircle2, XCircle } from "lucide-react";
import {
  assessServiceCoverage,
  type ServiceCoverage,
} from "@/lib/analysis/services";
import type { ColumnRole } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface ServiceCoverageCardProps {
  roleMap: Partial<Record<ColumnRole, string>>;
  onRequestMore?: (missing: { role: ColumnRole; label: string }[]) => void;
}

function StatusIcon({ available }: { available: boolean }) {
  return available ? (
    <CheckCircle2 className="h-4 w-4 text-success" />
  ) : (
    <XCircle className="h-4 w-4 text-danger" />
  );
}

export function ServiceCoverageCard({
  roleMap,
  onRequestMore,
}: ServiceCoverageCardProps) {
  const coverage = useMemo(() => assessServiceCoverage(roleMap), [roleMap]);
  const availableCount = coverage.filter((s) => s.available).length;
  const unavailableServices = coverage.filter((s) => !s.available);

  const [selectedMissing, setSelectedMissing] = useState<
    Map<ServiceCoverage["id"], { role: ColumnRole; label: string }[]>
  >(new Map());

  const toggleMissing = (
    svcId: ServiceCoverage["id"],
    missing: { role: ColumnRole; label: string }[],
  ) => {
    setSelectedMissing((prev) => {
      const next = new Map(prev);
      if (next.has(svcId)) {
        next.delete(svcId);
      } else {
        next.set(svcId, missing);
      }
      return next;
    });
  };

  const handleRequest = () => {
    if (!onRequestMore) return;
    const allMissing = Array.from(selectedMissing.values()).flat();
    onRequestMore(allMissing);
  };

  const totalSelected = Array.from(selectedMissing.values()).flat().length;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Service coverage</CardTitle>
          <Badge variant={availableCount === 9 ? "success" : "warning"}>
            {availableCount}/9 ready
          </Badge>
        </div>
        <p className="text-xs text-muted">
          Which of the 9 consulting services this file can power.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {coverage.map((svc) => (
            <div
              key={svc.id}
              className={`flex items-start gap-2 rounded-lg border p-2.5 text-sm transition ${
                svc.available
                  ? "border-success/25 bg-success-subtle/30"
                  : "border-border bg-surface-subtle"
              }`}
            >
              <StatusIcon available={svc.available} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="font-medium text-foreground">{svc.name}</span>
                  <span className="text-xs text-muted">{svc.nameAr}</span>
                </div>
                {svc.available ? (
                  <p className="mt-0.5 text-xs text-success">
                    Ready — {svc.present.map((p) => p.label).join(", ")}
                  </p>
                ) : (
                  <>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {svc.missing.map((m) => (
                        <span
                          key={m.role}
                          className="inline-block rounded-full border border-danger/25 bg-danger-subtle px-2 py-0.5 text-[10px] font-medium text-danger-text"
                        >
                          {m.label}
                        </span>
                      ))}
                    </div>
                    <Link
                      href={`/training/${svc.id}-analysis`}
                      className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-brand transition hover:underline"
                    >
                      <BookOpen className="h-3 w-3" />
                      Learn how to add this data
                    </Link>
                  </>
                )}
                {!svc.available && onRequestMore && (
                  <button
                    onClick={() => toggleMissing(svc.id, svc.missing)}
                    className={`mt-1.5 text-xs font-medium transition ${
                      selectedMissing.has(svc.id)
                        ? "text-brand underline"
                        : "text-muted hover:text-foreground hover:underline"
                    }`}
                  >
                    {selectedMissing.has(svc.id) ? "Selected" : "Request this data"}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        {onRequestMore && totalSelected > 0 && (
          <div className="flex items-center justify-between rounded-lg border border-brand/25 bg-brand-subtle/30 px-3 py-2">
            <span className="text-sm text-brand">
              {totalSelected} role{totalSelected !== 1 ? "s" : ""} requested
            </span>
            <Button size="sm" variant="primary" onClick={handleRequest}>
              Send request
            </Button>
          </div>
        )}

        {unavailableServices.length > 0 && (
          <p className="text-xs text-muted">
            Assign column roles in the preview table above to unlock more services.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
