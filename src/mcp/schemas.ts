import { z, type ZodRawShape } from "zod";

export const noParamsInputSchema = z.object({}).optional();

export function successOutputSchema<DataShape extends ZodRawShape>(dataShape: DataShape) {
  return {
    ok: z.literal(true),
    data: z.object(dataShape)
  };
}
