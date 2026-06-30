import { z, type ZodRawShape } from "zod";

// No-parameter tools. The `.optional()` is load-bearing: it lets the tool be called with
// no arguments at all (undefined args validate). A bare `{}`/`z.object({})` would instead
// REQUIRE an (empty) object and reject an argument-less call, so this is not a no-op.
export const noParamsInputSchema = z.object({}).optional();

export function successOutputSchema<DataShape extends ZodRawShape>(dataShape: DataShape) {
  return {
    ok: z.literal(true),
    data: z.object(dataShape)
  };
}
