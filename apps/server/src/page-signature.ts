import { createHash } from "crypto";

/**
 * Page signature for macro keying and loop detection.
 * More specific signature that includes full URL path and visible elements
 * to prevent macros from being applied to wrong page states.
 */
export function computePageSignature(
  hostname: string,
  pathname: string,
  h1: string,
  formLabels: string[],
  primaryButtonTexts: string[]
): string {
  // Normalize pathname to handle trailing slashes
  const normalizedPath = pathname.replace(/\/$/, '') || '/';
  
  // Sort labels for consistency
  const sortedFormLabels = [...formLabels].sort().slice(0, 10);
  const sortedButtons = [...primaryButtonTexts].sort().slice(0, 5);
  
  const parts = [
    hostname,
    normalizedPath,
    h1.toLowerCase().trim(),
    sortedFormLabels.join("|").toLowerCase(),
    sortedButtons.join("|").toLowerCase(),
  ];
  const str = parts.join("\n");
  return createHash("sha256").update(str).digest("hex").slice(0, 32);
}

/**
 * Alternative signature that's more granular - includes URL query params
 * Use this for high-specificity matching
 */
export function computeDetailedPageSignature(
  fullUrl: string,
  title: string,
  visibleElements: string[]
): string {
  const parts = [
    fullUrl,
    title.toLowerCase().trim(),
    visibleElements.slice(0, 15).map(e => e.toLowerCase().trim()).sort().join("|"),
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
