import type { Command } from "commander";
import { BrvBridge } from "@byterover/brv-bridge";
import { UserPromptSubmitHookInputSchema } from "../schemas/cc-hook-input.js";
import { readStdinJson } from "../stdin.js";

export function registerRecallCommand(program: Command): void {
  program
    .command("recall")
    .description(
      "Query ByteRover for context relevant to the user prompt (called by UserPromptSubmit hook)",
    )
    .action(async () => {
      try {
        const input = await readStdinJson(UserPromptSubmitHookInputSchema);
        const { prompt, cwd } = input;

        // Skip trivially short prompts
        if (prompt.trim().length < 5) {
          process.exit(0);
        }

        // Query ByteRover with the actual user prompt
        const bridge = new BrvBridge({ cwd, recallTimeoutMs: 6_000 });
        const { content } = await bridge.recall(prompt);

        if (!content) {
          process.exit(0);
        }

        // Return additionalContext wrapped in hookSpecificOutput for Claude Code
        const output = {
          hookSpecificOutput: {
            hookEventName: "UserPromptSubmit",
            additionalContext:
              `<byterover-context>\n` +
              `The following knowledge is from ByteRover context engine:\n\n` +
              `${content}\n` +
              `</byterover-context>`,
          },
        };

        console.log(JSON.stringify(output));
        process.exit(0);
      } catch {
        // All errors → silent exit 0. Never block the prompt.
        process.exit(0);
      }
    });
}
