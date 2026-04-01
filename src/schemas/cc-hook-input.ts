import { z } from "zod";

/**
 * Schema for the JSON that Claude Code pipes to hook commands via stdin.
 * Matches upstream: cc-ts/entrypoints/sdk/coreSchemas.ts
 */
export const BaseHookInputSchema = z.object({
  session_id: z.string(),
  transcript_path: z.string(),
  cwd: z.string(),
  permission_mode: z.string().optional(),
  agent_id: z.string().optional(),
  agent_type: z.string().optional(),
});

export const PostToolUseHookInputSchema = BaseHookInputSchema.extend({
  hook_event_name: z.literal("PostToolUse"),
  tool_name: z.string(),
  tool_input: z.unknown(),
  tool_response: z.unknown(),
  tool_use_id: z.string(),
});

export const StopHookInputSchema = BaseHookInputSchema.extend({
  hook_event_name: z.literal("Stop"),
  stop_hook_active: z.boolean(),
  last_assistant_message: z.string().optional(),
});

export type PostToolUseHookInput = z.infer<typeof PostToolUseHookInputSchema>;
export type StopHookInput = z.infer<typeof StopHookInputSchema>;
