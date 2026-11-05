// Domain schemas shared by the workflow, API routes, and fixtures.
// Every LLM output and every API body is validated against one of these.
import { z } from "zod";

const cents = z.number().int().nonnegative();
const isoDateTime = z.iso.datetime({ offset: true });

export const ActionSchema = z.enum(["fill", "hold", "ask", "skip"]);
export type Action = z.infer<typeof ActionSchema>;

// Step 1 output.
export const SpecSchema = z.object({
  category: z.string().min(1),
  mustHaves: z.array(z.string().min(1)),
  niceToHaves: z.array(z.string().min(1)),
  maxPriceCents: z.number().int().positive().describe("Max price in US cents, e.g. 29900 for $299"),
  constraints: z.array(z.string().min(1)),
  restatement: z.string().min(1).describe("Plain-English restatement for the user to confirm"),
});
export type Spec = z.infer<typeof SpecSchema>;

// A product as returned by lib/channel3.ts (already mapped from Channel3's shape).
export const ProductSchema = z.object({
  productId: z.string().min(1),
  title: z.string().min(1),
  merchant: z.string().min(1),
  priceCents: cents,
  url: z.url().nullable(),
});
export type Product = z.infer<typeof ProductSchema>;

export const MustHaveCheckSchema = z.object({
  requirement: z.string().min(1),
  pass: z.boolean(),
});
export type MustHaveCheck = z.infer<typeof MustHaveCheckSchema>;

// Step 2 model output, one per product.
export const CandidateScoreSchema = z.object({
  productId: z.string().min(1),
  fitScore: z.number().int().min(0).max(100),
  mustHaves: z.array(MustHaveCheckSchema),
  reasoning: z.string().min(1).describe("One line"),
});
export type CandidateScore = z.infer<typeof CandidateScoreSchema>;

export type ScoredCandidate = Product & Omit<CandidateScore, "productId">;

export const PricePointSchema = z.object({
  priceCents: cents,
  observedAt: isoDateTime,
});
export type PricePoint = z.infer<typeof PricePointSchema>;

export const SaleEventSchema = z.object({
  name: z.string().min(1),
  date: z.iso.date(),
});
export type SaleEvent = z.infer<typeof SaleEventSchema>;

// The user's limits for one standing order; read by step 3 (as context) and enforced by step 4.
export const OrderPolicySchema = z.object({
  maxPriceCents: z.number().int().positive(),
  perOrderCapCents: z.number().int().positive(),
  monthlyCapCents: z.number().int().positive(),
  merchantAllowlist: z.array(z.string().min(1)),
});
export type OrderPolicy = z.infer<typeof OrderPolicySchema>;

// Step 3 model output.
export const DecisionSchema = z.object({
  action: ActionSchema,
  productId: z.string().min(1).nullable().describe("The candidate this decision is about, or null"),
  reasoning: z.string().min(1),
});
export type Decision = z.infer<typeof DecisionSchema>;

// ---- API bodies ----

export const CreateOrderBodySchema = z.object({
  rawIntent: z.string().trim().min(3).max(1000),
  perOrderCapCents: z.number().int().positive(),
  monthlyCapCents: z.number().int().positive(),
  merchantAllowlist: z.array(z.string().min(1)).default([]),
});
export type CreateOrderBody = z.infer<typeof CreateOrderBodySchema>;

export const PriceOverrideBodySchema = z.object({
  productId: z.string().min(1),
  priceCents: z.number().int().positive(),
});
export type PriceOverrideBody = z.infer<typeof PriceOverrideBodySchema>;
