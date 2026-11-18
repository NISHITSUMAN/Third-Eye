export function isLandingPath(pathname: string): boolean {
  return pathname === "/landing" || pathname.startsWith("/landing/");
}

export function isPublicPath(pathname: string): boolean {
  return !pathname.startsWith("/api/");
}

export function requiresApplicationAuthentication(_pathname: string): boolean {
  return false;
}

export function usesStandaloneLayout(_pathname: string): boolean {
  return true;
}

export function safeAuthReturnPath(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    [...value].some((character) => character.charCodeAt(0) < 0x20)
  ) {
    return "/landing";
  }

  const target = new URL(value, "https://third-eye.invalid");
  const isLandingDestination = isLandingPath(target.pathname) &&
    target.pathname !== "/landing/login" &&
    target.pathname !== "/landing/auth/callback";
  const isApplicationDestination = target.pathname !== "/" &&
    target.pathname !== "/login" &&
    target.pathname !== "/auth/callback" &&
    !isLandingPath(target.pathname) &&
    !target.pathname.startsWith("/api/");
  if (
    target.origin !== "https://third-eye.invalid" ||
    (!isLandingDestination && !isApplicationDestination)
  ) {
    return "/landing";
  }

  return `${target.pathname}${target.search}${target.hash}`;
}

export function legacyRouteRedirect(pathname: string): string {
  if (pathname === "/login" || pathname === "/auth/callback") return "/dashboard";
  return pathname;
}
