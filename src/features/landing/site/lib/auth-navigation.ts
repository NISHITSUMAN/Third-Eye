export function safeAuthReturnPath(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\') ||
    [...value].some((character) => character.charCodeAt(0) < 0x20)
  ) {
    return '/landing';
  }

  const target = new URL(value, 'https://third-eye.invalid');
  const isLandingDestination = target.pathname === '/landing' ||
    (target.pathname.startsWith('/landing/') &&
      target.pathname !== '/landing/login' &&
      target.pathname !== '/landing/auth/callback');
  const isApplicationDestination = target.pathname !== '/' &&
    target.pathname !== '/login' &&
    target.pathname !== '/auth/callback' &&
    target.pathname !== '/landing' &&
    !target.pathname.startsWith('/landing/') &&
    !target.pathname.startsWith('/api/');

  if (
    target.origin !== 'https://third-eye.invalid' ||
    (!isLandingDestination && !isApplicationDestination)
  ) {
    return '/landing';
  }

  return `${target.pathname}${target.search}${target.hash}`;
}

export function localLandingPath(destination: string): string | null {
  if (destination !== '/landing' && !destination.startsWith('/landing/')) return null;
  return destination.slice('/landing'.length) || '/';
}
