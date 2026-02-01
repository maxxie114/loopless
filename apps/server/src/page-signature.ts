import { createHash } from "crypto";

/**
 * Page signature for macro keying and loop detection.
 * sha256(hostname + pathname + h1 + form_labels + primary_button_texts)
 */
export function computePageSignature(
  hostname: string,
  pathname: string,
  h1: string,
  formLabels: string[],
  primaryButtonTexts: string[]
): string {
  const parts = [
    hostname,
    pathname,
    h1,
    formLabels.slice(0, 10).join("|"),
    primaryButtonTexts.slice(0, 5).join("|"),
  ];
  const str = parts.join("\n");
  return createHash("sha256").update(str).digest("hex").slice(0, 32);
}

export function getHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

export function getPathname(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return "/";
  }
}
