/**
 * Contract for resolving display-friendly session names from
 * user prompts and plan files.
 */
export interface ISessionNameResolver {
  /** Extract a display-friendly name from the first user prompt text. */
  resolveFromPrompt(firstPromptText: string): string;

  /** Async check for a matching plan file; returns H1 title or undefined. */
  resolveFromPlanFile(slug: string): Promise<string | undefined>;

  /** Check if a file path is a plan file matching this session's slug. */
  isPlanFilePath(filePath: string, slug: string): boolean;
}
