import { describe, it, expect } from "vitest";
import { parseLastJsonLine } from "../src/brv-process.js";

describe("parseLastJsonLine", () => {
  it("parses a single JSON line", () => {
    const result = parseLastJsonLine<{ status: string }>(
      '{"command":"curate","success":true,"timestamp":"2026-04-01","data":{"status":"queued"}}\n',
    );
    expect(result.success).toBe(true);
    expect(result.data.status).toBe("queued");
  });

  it("returns the last JSON line from NDJSON", () => {
    const stdout = [
      '{"command":"query","data":{"event":"response","content":"partial"},"success":true,"timestamp":"t1"}',
      '{"command":"query","data":{"event":"completed","status":"completed","result":"full answer"},"success":true,"timestamp":"t2"}',
    ].join("\n");

    const result = parseLastJsonLine<{ event: string; result?: string }>(
      stdout,
    );
    expect(result.data.event).toBe("completed");
    expect(result.data.result).toBe("full answer");
  });

  it("skips non-JSON lines", () => {
    const stdout = "some log output\n" +
      '{"command":"curate","success":true,"timestamp":"t","data":{"status":"ok"}}\n';
    const result = parseLastJsonLine<{ status: string }>(stdout);
    expect(result.data.status).toBe("ok");
  });

  it("throws on empty input", () => {
    expect(() => parseLastJsonLine("")).toThrow("No valid JSON");
  });

  it("throws on non-JSON input", () => {
    expect(() => parseLastJsonLine("not json at all")).toThrow(
      "No valid JSON",
    );
  });
});
