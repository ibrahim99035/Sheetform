"use server";

import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export interface TrainingLesson {
  id: string;
  slug: string;
  title_ar: string;
  title_en: string;
  service_id: string;
  body_md: string;
  order_index: number;
  visibility: string;
  completed?: boolean;
}

export const getTrainingLessons = cache(async (serviceId?: string) => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  let query = supabase
    .from("training_lessons")
    .select("*")
    .order("order_index");

  if (serviceId) {
    query = query.eq("service_id", serviceId);
  }

  const { data: lessons, error } = await query;
  if (error || !lessons) return [];

  const { data: progress } = await supabase
    .from("training_progress")
    .select("lesson_slug")
    .eq("user_id", user.id);

  const completedSlugs = new Set(
    (progress ?? []).map((p) => p.lesson_slug),
  );

  return (lessons as TrainingLesson[]).map((l) => ({
    ...l,
    completed: completedSlugs.has(l.slug),
  }));
});

export const getTrainingLesson = cache(async (slug: string) => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: lesson, error } = await supabase
    .from("training_lessons")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();

  if (error || !lesson) return null;

  const { data: progress } = await supabase
    .from("training_progress")
    .select("completed_at")
    .eq("user_id", user.id)
    .eq("lesson_slug", slug)
    .maybeSingle();

  return {
    ...(lesson as TrainingLesson),
    completed: !!progress,
    completedAt: progress?.completed_at,
  };
});

export async function markLessonComplete(slug: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { error } = await supabase.from("training_progress").upsert(
    {
      user_id: user.id,
      lesson_slug: slug,
    },
    { onConflict: "user_id,lesson_slug" },
  );

  if (error) throw error;
  return { success: true };
}

export async function unmarkLesson(slug: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { error } = await supabase
    .from("training_progress")
    .delete()
    .eq("user_id", user.id)
    .eq("lesson_slug", slug);

  if (error) throw error;
  return { success: true };
}
