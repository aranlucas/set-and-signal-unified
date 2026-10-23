import { GarminError } from "./garmin-error";

export async function readBounded(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (!response.body) {
    return new Uint8Array();
  }

  const chunks: Uint8Array[] = [];
  let total = 0;

  // Leaving the loop early cancels the stream.
  for await (const chunk of response.body) {
    if (!(chunk instanceof Uint8Array)) {
      throw new GarminError("Garmin returned an unreadable response.", 502);
    }

    total += chunk.byteLength;

    if (total > maxBytes) {
      throw new GarminError(
        "Garmin response is too large. Narrow the date range or activity limit.",
        413,
      );
    }

    chunks.push(chunk);
  }

  const result = new Uint8Array(total);
  let offset = 0;

  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return result;
}
