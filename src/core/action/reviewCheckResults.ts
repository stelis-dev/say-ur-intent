import type { ReviewCheck, ReviewCheckSource } from "./types.js";

export function passReviewCheck(
  id: string,
  label: string,
  message: string,
  source: ReviewCheckSource
): ReviewCheck {
  return { id, label, status: "pass", message, source };
}

export function failReviewCheck(
  id: string,
  label: string,
  message: string,
  source: ReviewCheckSource
): ReviewCheck {
  return { id, label, status: "fail", message, source };
}
