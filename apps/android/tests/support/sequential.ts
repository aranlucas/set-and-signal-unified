type SequentialAction<Value> = (value: Value, index: number) => void | Promise<void>;

/** UI journeys mutate one shared device or renderer, so each action must finish before the next. */
export function runSequentially<Value>(
  values: readonly Value[],
  action: SequentialAction<Value>,
): Promise<void> {
  return values.reduce(
    (previous, value, index) => previous.then(() => action(value, index)),
    Promise.resolve(),
  );
}
