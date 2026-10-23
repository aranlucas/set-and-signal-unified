export function requireValue<Value>(
  value: Value | null | undefined,
  message = "Expected a value to be present.",
): Value {
  if (value === null || value === undefined) {
    throw new Error(message);
  }

  return value;
}
