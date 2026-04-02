import type { Command } from "commander";
import { brvQuery } from "../brv-process.js";
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
        let resultText: string | undefined;
        try {
          const response = await brvQuery({
            cwd,
            query: prompt,
            timeoutMs: 6_000,
          });
          resultText =
            response.data?.result ?? response.data?.content ?? undefined;
          if (resultText && !resultText.trim()) {
            resultText = undefined;
          }
        } catch {
          // brv query failed or timed out — proceed without context
          process.exit(0);
        }

        if (!resultText) {
          process.exit(0);
        }

        // Return additionalContext wrapped in hookSpecificOutput for Claude Code
        const output = {
          hookSpecificOutput: {
            hookEventName: "UserPromptSubmit",
            additionalContext:
              `<byterover-context>\n` +
              `The following knowledge is from ByteRover context engine:\n\n` +
              `${resultText.trim()}\n` +
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
