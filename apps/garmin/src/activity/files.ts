import { z } from "zod";
import { readBounded } from "../garmin";
import { decodeActivityFile, MAX_FIT_BYTES } from "./fit";

export const garminActivityId = z.union([
  z.number().int().positive().safe().transform(String),
  z.string().regex(/^[1-9][0-9]{0,19}$/),
]);

/** Only the file-specific business API callback documented by Garmin Activity API 2.0. */
export function activityFileUrl(value: string): string {
  const url = URL.parse(value);

  if (
    url?.origin !== "https://apis.garmin.com" ||
    url.pathname !== "/wellness-api/rest/activityFile" ||
    url.username ||
    url.password ||
    url.hash ||
    url.searchParams.getAll("id").length !== 1 ||
    !url.searchParams.get("id") ||
    url.searchParams.getAll("token").length !== 1 ||
    !url.searchParams.get("token") ||
    [...url.searchParams.keys()].some((key) => key !== "id" && key !== "token")
  ) {
    throw new Error("Invalid Garmin activity file callback.");
  }

  return url.href;
}

export const activityFileNotification = z.object({
  userId: z.string().min(1).max(255),
  summaryId: z.string().min(1).max(255),
  activityId: garminActivityId,
  fileType: z.enum(["FIT", "TCX", "GPX"]),
  callbackURL: z
    .string()
    .max(4096)
    .transform((value, ctx) => {
      try {
        return activityFileUrl(value);
      } catch {
        ctx.addIssue({ code: "custom", message: "Invalid Garmin activity file callback." });

        return z.NEVER;
      }
    }),
  startTimeInSeconds: z.number().int().nonnegative(),
});

export type ActivityFileNotification = z.infer<typeof activityFileNotification>;

export type FitDetails = ReturnType<typeof decodeActivityFile> & {
  activityId: string;
  fileSummaryId: string;
};

export async function fetchActivityFile(
  url: string,
  accessToken: string,
  signal: AbortSignal,
  fetcher: typeof fetch,
) {
  const response = await fetcher(activityFileUrl(url), {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/octet-stream" },
    redirect: "error",
    signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
  });

  if (!response.ok) {
    await response.body?.cancel();
    throw new Error("Garmin activity file is unavailable.");
  }

  const bytes = await readBounded(response, MAX_FIT_BYTES);
  const decoded = decodeActivityFile(bytes);

  return {
    ...decoded,
    source: "Garmin Activity API FIT file",
    provenance:
      "All SDK-decoded FIT activity messages and fields, associated by Garmin's activityFiles activityId.",
  };
}
