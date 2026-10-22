/** Fails the current test when a value the scenario depends on is missing. */
export function required<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) {
    throw new Error(`Missing ${label}`);
  }

  return value;
}

export function requestUrl(input: RequestInfo | URL): string {
  return input instanceof Request ? input.url : input.toString();
}
