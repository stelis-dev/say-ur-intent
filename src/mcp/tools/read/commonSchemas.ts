import { z } from "zod";
import { DEEPBOOK_MID_PRICE_PRECISION } from "../../../core/read/readService.js";

export const fetchedAtSchema = z.string().refine((value) => {
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}, "Expected ISO 8601 UTC timestamp");

export const readSourceSchema = z.object({
  sdk: z.string(),
  transport: z.literal("grpc"),
  simulation: z.literal("client.core.simulateTransaction").optional(),
  method: z.string().optional(),
  methods: z.array(z.string()).optional(),
  returnValueEncoding: z.string().optional(),
  precision: z.literal(DEEPBOOK_MID_PRICE_PRECISION).optional()
});

export const reviewActivityAccountSourceSchema = z.enum(["active_account_context", "explicit_filter"]);

export const reviewActivityDataScopeSchema = z.object({
  account: z.string(),
  from: fetchedAtSchema.optional(),
  to: fetchedAtSchema.optional(),
  recordCount: z.number().int().nonnegative()
});

export const reviewActivityInputSchema = {
  account: z.string().min(1).optional(),
  from: fetchedAtSchema.optional(),
  to: fetchedAtSchema.optional()
};

export const userAnswerUseSchema = z.object({
  canAnswer: z.array(z.string()),
  cannotAnswer: z.array(z.string()),
  answerFields: z.array(z.string()),
  preconditionFields: z.array(z.string()).optional(),
  conclusionRuleFields: z.array(z.string()).optional(),
  diagnosticOnlyFields: z.array(z.string()).optional(),
  followUp: z
    .object({
      tool: z.string(),
      inputFields: z.array(z.string()).optional(),
      answerFields: z.array(z.string()),
      reason: z.string()
    })
    .optional()
}).strict();
