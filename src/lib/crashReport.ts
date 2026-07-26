export interface CrashReportContext {
  timestamp: string;
  userAgent: string;
}

export function buildCrashReport(
  error: Error,
  componentStack: string,
  context: CrashReportContext,
): string {
  return [
    "[Glyphra UI crash]",
    `time: ${context.timestamp}`,
    `ua: ${context.userAgent}`,
    "",
    `${error.name}: ${error.message}`,
    error.stack ?? "",
    "",
    `Component stack:${componentStack}`,
  ].join("\n");
}
