/** Only safe messages leave this boundary; upstream bodies can contain personal data. */
export class GarminError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
