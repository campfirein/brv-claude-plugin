import yaml from "js-yaml";

// Match cc-ts/utils/frontmatterParser.ts line 123
const FRONTMATTER_REGEX = /^---\s*\n([\s\S]*?)---\s*\n?/;

const VALID_TYPES = ["user", "feedback", "project", "reference"] as const;

export type CcMemoryType = (typeof VALID_TYPES)[number];

export interface CcMemoryFrontmatter {
  name: string;
  description: string;
  type: CcMemoryType;
}

export interface CcMemoryFile {
  frontmatter: CcMemoryFrontmatter;
  body: string;
}

/**
 * Parse a Claude Code memory file into frontmatter + body.
 * Returns null if the file is not a valid cc-ts memory file.
 */
export function parseCcMemoryFile(content: string): CcMemoryFile | null {
  const match = content.match(FRONTMATTER_REGEX);
  if (!match) return null;

  const raw = match[1] || "";
  const body = content.slice(match[0].length);

  try {
    const fm = yaml.load(raw) as Record<string, unknown> | null;
    if (!fm || typeof fm !== "object") return null;
    if (typeof fm.name !== "string") return null;
    if (typeof fm.type !== "string") return null;

    const type = fm.type as string;
    if (!VALID_TYPES.includes(type as CcMemoryType)) return null;

    return {
      frontmatter: {
        name: fm.name,
        description:
          typeof fm.description === "string" ? fm.description : "",
        type: type as CcMemoryType,
      },
      body,
    };
  } catch {
    return null;
  }
}

/**
 * Map cc-ts memory type to ByteRover context tree domain path.
 */
export function ccTypeToDomain(type: CcMemoryType): string {
  const map: Record<CcMemoryType, string> = {
    user: "_cc/user",
    feedback: "_cc/feedback",
    project: "_cc/project",
    reference: "_cc/reference",
  };
  return map[type];
}
