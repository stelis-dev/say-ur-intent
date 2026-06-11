import type { AdapterLifecycleValidator } from "./adapterLifecycleValidation.js";
import { reviewStateStructuralInvariantSchema } from "./schemas.js";
import type { ReviewState } from "./types.js";

export function parseReviewStateStructuralInvariants(input: unknown): ReviewState {
  return reviewStateStructuralInvariantSchema.parse(input) as ReviewState;
}

export function parseLifecycleValidatedReviewState(
  input: unknown,
  validateAdapterLifecycle: AdapterLifecycleValidator
): ReviewState {
  const parsed = parseReviewStateStructuralInvariants(input);
  if (parsed.adapterLifecycle) {
    validateAdapterLifecycle(parsed.adapterLifecycle);
  }
  return parsed;
}
