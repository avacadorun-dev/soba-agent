import { z } from "zod";

export const initializeParamsSchema = z.object({
  protocolVersion: z.number().int().positive().optional(),
  clientCapabilities: z.record(z.string(), z.unknown()).optional(),
  clientInfo: z
    .object({
      name: z.string().optional(),
      version: z.string().optional(),
    })
    .passthrough()
    .optional(),
}).passthrough();

export const sessionNewParamsSchema = z.object({
  cwd: z.string().min(1).optional(),
}).passthrough();

export const sessionCancelParamsSchema = z.object({
  sessionId: z.string().min(1),
}).passthrough();
