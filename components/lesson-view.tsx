"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowLeft, CheckCircle2, RotateCcw } from "lucide-react";
import type { TrainingLesson } from "@/lib/actions/training";
import { markLessonComplete, unmarkLesson } from "@/lib/actions/training";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function renderMarkdown(body: string) {
  const lines = body.split("\n");
  const nodes: React.ReactNode[] = [];
  let key = 0;

  for (const line of lines) {
    if (line.startsWith("## ")) {
      nodes.push(
        <h2 key={key++} className="mt-6 mb-2 text-lg font-semibold text-foreground">
          {line.slice(3)}
        </h2>,
      );
    } else if (line.startsWith("- ")) {
      nodes.push(
        <li key={key++} className="ml-4 text-sm text-foreground/80">
          {renderInline(line.slice(2))}
        </li>,
      );
    } else if (line.trim() === "") {
      nodes.push(<div key={key++} className="h-2" />);
    } else {
      nodes.push(
        <p key={key++} className="text-sm text-foreground/80">
          {renderInline(line)}
        </p>,
      );
    }
  }
  return nodes;
}

function renderInline(text: string) {
  const parts: React.ReactNode[] = [];
  const regex = /\*\*(.+?)\*\*/g;
  let lastIdx = 0;
  let match;
  let key = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIdx) {
      parts.push(text.slice(lastIdx, match.index));
    }
    parts.push(
      <strong key={key++} className="font-semibold text-foreground">
        {match[1]}
      </strong>,
    );
    lastIdx = regex.lastIndex;
  }
  if (lastIdx < text.length) {
    parts.push(text.slice(lastIdx));
  }
  return parts.length > 0 ? parts : text;
}

export function LessonView({ lesson }: { lesson: TrainingLesson }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [completed, setCompleted] = useState(lesson.completed);

  function handleToggle() {
    startTransition(async () => {
      if (completed) {
        await unmarkLesson(lesson.slug);
        setCompleted(false);
      } else {
        await markLessonComplete(lesson.slug);
        setCompleted(true);
      }
      router.refresh();
    });
  }

  return (
    <div className="animate-slide-up space-y-5">
      <div className="flex items-center gap-3">
        <Link
          href="/training"
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted transition hover:bg-surface-subtle hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold text-foreground">{lesson.title_en}</h1>
            <span className="text-base text-muted">{lesson.title_ar}</span>
          </div>
          <div className="mt-0.5 flex items-center gap-2">
            <Badge variant={completed ? "success" : "neutral"}>
              {lesson.service_id}
            </Badge>
            {completed && (
              <span className="text-xs text-success">Completed</span>
            )}
          </div>
        </div>
      </div>

      <Card>
        <CardContent className="prose-sm max-w-none p-6">
          {renderMarkdown(lesson.body_md)}
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Button
          onClick={handleToggle}
          disabled={isPending}
          variant={completed ? "secondary" : "primary"}
          size="md"
        >
          {completed ? (
            <>
              <RotateCcw className="h-4 w-4" />
              Mark incomplete
            </>
          ) : (
            <>
              <CheckCircle2 className="h-4 w-4" />
              Mark complete
            </>
          )}
        </Button>
        <Link href="/training" className={buttonClasses("ghost", "md")}>
          Back to lessons
        </Link>
      </div>
    </div>
  );
}
