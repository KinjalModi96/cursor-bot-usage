"use client";

import { useEffect, useState } from "react";
import { CalendarRange, Crown } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate, membershipLabel } from "@/lib/utils";

interface BillingCardProps {
  start: string;
  end: string;
  membershipType: string;
}

function billingProgress(start: string, end: string, now: number) {
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  const total = Math.max(1, e - s);
  const elapsed = Math.max(0, Math.min(total, now - s));
  return {
    pct: (elapsed / total) * 100,
    daysLeft: Math.max(0, Math.ceil((e - now) / 86_400_000)),
  };
}

export function BillingCard({ start, end, membershipType }: BillingCardProps) {
  const [progress, setProgress] = useState({ pct: 0, daysLeft: 0 });

  useEffect(() => {
    setProgress(billingProgress(start, end, Date.now()));
  }, [start, end]);

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="flex items-center gap-2">
          <CalendarRange className="h-4 w-4" /> Billing Cycle
        </CardTitle>
        <Badge variant="success" className="gap-1">
          <Crown className="h-3 w-3" />
          {membershipLabel(membershipType)}
        </Badge>
      </CardHeader>
      <CardContent>
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-muted-foreground">{formatDate(start)}</span>
          <span className="text-sm text-muted-foreground">{formatDate(end)}</span>
        </div>
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-secondary/70">
          <div
            className="h-full rounded-full bg-gradient-accent transition-[width] duration-1000"
            style={{ width: `${progress.pct}%` }}
          />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {progress.daysLeft} day{progress.daysLeft === 1 ? "" : "s"} remaining ·{" "}
          {progress.pct.toFixed(0)}% of cycle elapsed
        </p>
      </CardContent>
    </Card>
  );
}
