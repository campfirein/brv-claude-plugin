import type { ZodSchema } from "zod";

/**
 * Read all data from stdin, parse as JSON, and validate with a Zod schema.
 * Used by hook commands (ingest, sync) to read the JSON that Claude Code
 * pipes to hook processes.
 */
export async function readStdinJson<T>(schema: ZodSchema<T>): Promise<T> {
  const chunks: Buffer[] = [];

  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) {
    throw new Error("No input received on stdin");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid JSON on stdin: ${raw.slice(0, 200)}`);
  }

  return schema.parse(parsed);
}
