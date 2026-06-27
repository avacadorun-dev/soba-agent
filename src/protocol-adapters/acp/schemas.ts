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
  cwd: z.string().min(1),
}).passthrough();

export const sessionCancelParamsSchema = z.object({
  sessionId: z.string().min(1),
}).passthrough();

export const sessionIdParamsSchema = z.object({
  sessionId: z.string().min(1),
}).passthrough();

export const sessionListParamsSchema = z.object({
  cwd: z.string().min(1).optional(),
}).passthrough();

const textContentSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
}).passthrough();

const resourceContentSchema = z.object({
  type: z.literal("resource"),
  resource: z.object({
    uri: z.string(),
    text: z.string(),
    mimeType: z.string().optional(),
  }).passthrough(),
}).passthrough();

const resourceLinkContentSchema = z.object({
  type: z.literal("resource_link"),
  uri: z.string(),
  name: z.string(),
  mimeType: z.string().optional(),
}).passthrough();

const imageContentSchema = z.object({
  type: z.literal("image"),
  mimeType: z.string(),
  data: z.string(),
}).passthrough();

export const acpContentBlockSchema = z.union([
  textContentSchema,
  resourceContentSchema,
  resourceLinkContentSchema,
  imageContentSchema,
]);

export const sessionPromptParamsSchema = z.object({
  sessionId: z.string().min(1),
  prompt: z.array(acpContentBlockSchema).min(1),
}).passthrough();

export const setSessionConfigParamsSchema = z.object({
  sessionId: z.string().min(1),
  key: z.string().min(1),
  value: z.unknown(),
}).passthrough();

export const setSessionModeParamsSchema = z.object({
  sessionId: z.string().min(1),
  mode: z.string().min(1),
  enabled: z.boolean(),
}).passthrough();
