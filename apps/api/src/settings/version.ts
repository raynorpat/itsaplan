import pkg from '../../../../package.json';

// The version of the app this instance runs (the root package.json version).
export function getAppVersion(): string {
  return pkg.version;
}
