import { Decoder, Profile, Stream, Utils } from "@garmin/fitsdk";
import { z } from "zod";

export const MAX_FIT_BYTES = 1024 * 1024;

export const MAX_FIT_MESSAGES = 25_000;

export const MAX_STRENGTH_SETS = 2_000;

export const MAX_EXERCISE_ENTRIES = 4_000;

const MAX_BASE64_LENGTH = 4 * Math.ceil(MAX_FIT_BYTES / 3);

export const strengthFileInput = z.strictObject({
  fitBase64: z
    .string()
    .min(1)
    .max(MAX_BASE64_LENGTH)
    .describe(
      "Canonical base64 of one uncompressed FIT activity file, at most 1 MiB. Not a URL, data URL, ZIP, or planned workout file.",
    ),
});

const optionalNumber = z.number().finite().nonnegative().nullish();

const optionalInteger = z.number().int().nonnegative().nullish();

const setMessage = z.object({
  timestamp: optionalInteger,
  startTime: optionalInteger,
  duration: optionalNumber,
  repetitions: optionalInteger,
  weight: optionalNumber,
  setType: optionalInteger,
  category: z.array(optionalInteger).nullish(),
  categorySubtype: z.array(optionalInteger).nullish(),
  weightDisplayUnit: optionalInteger,
  messageIndex: optionalInteger,
  wktStepIndex: optionalInteger,
});

function profileName(type: string, value: number | null | undefined): string | null {
  return value === null || value === undefined ? null : (Profile.types[type]?.[value] ?? null);
}

function timestamp(value: number | null | undefined): string | null {
  // FIT date_time values below 0x10000000 are relative/system times, not UTC dates.
  return value === null || value === undefined || value < 0x10000000
    ? null
    : Utils.convertDateTimeToDate(value).toISOString();
}

function normalizeSet(set: z.infer<typeof setMessage>, index: number) {
  const categories = set.category ?? [];
  const subtypes = set.categorySubtype ?? [];

  const exercises = Array.from({ length: Math.max(categories.length, subtypes.length) }, (_, i) => {
    const categoryId = categories[i] ?? null;
    const subtypeId = subtypes[i] ?? null;
    const category = profileName("exerciseCategory", categoryId);

    return {
      categoryId,
      category,
      subtypeId,
      name: category ? profileName(`${category}ExerciseName`, subtypeId) : null,
    };
  });

  return {
    index,
    messageIndex: set.messageIndex ?? null,
    workoutStepIndex: set.wktStepIndex ?? null,
    setTypeId: set.setType ?? null,
    setType: profileName("setType", set.setType),
    startTimeUtc: timestamp(set.startTime),
    recordedTimestampUtc: timestamp(set.timestamp),
    durationSeconds: set.duration ?? null,
    repetitions: set.repetitions ?? null,
    weightKg: set.weight ?? null,
    weightDisplayUnitId: set.weightDisplayUnit ?? null,
    weightDisplayUnit: profileName("fitBaseUnit", set.weightDisplayUnit),
    exercises,
  };
}

/** Decode only recorded set messages. No URLs, network access, persistence, or guessed metrics. */
export function decodeStrengthActivityFile(fitBase64: string) {
  if (
    fitBase64.length === 0 ||
    fitBase64.length > MAX_BASE64_LENGTH ||
    fitBase64.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(fitBase64)
  ) {
    throw new Error("Provide canonical base64 of an uncompressed FIT activity file up to 1 MiB.");
  }

  const bytes = Buffer.from(fitBase64, "base64");

  if (bytes.length > MAX_FIT_BYTES || bytes.toString("base64") !== fitBase64) {
    throw new Error("Provide canonical base64 of an uncompressed FIT activity file up to 1 MiB.");
  }

  const decoder = new Decoder(Stream.fromBuffer(bytes));

  if (!decoder.isFIT() || !decoder.checkIntegrity()) {
    throw new Error("The file is not a complete, valid FIT file. Unzip an original export first.");
  }

  // The SDK permits trailing bytes; this tool accepts exactly one file, not concatenated files.
  if (bytes.length !== (bytes[0] ?? 0) + bytes.readUInt32LE(4) + 2) {
    throw new Error("Provide exactly one FIT file without trailing data.");
  }

  let messageCount = 0;
  let setCount = 0;

  let exerciseCount = 0;

  const recordedSets: z.infer<typeof setMessage>[] = [];

  let limitExceeded = false;

  function countRecord() {
    messageCount += 1;

    if (messageCount > MAX_FIT_MESSAGES) {
      limitExceeded = true;
      throw new Error("FIT decode limit exceeded.");
    }
  }

  const decoded = decoder.read({
    applyScaleAndOffset: true,
    convertTypesToStrings: false,
    convertDateTimesToDates: false,
    expandSubFields: false,
    expandComponents: false,
    mergeHeartRates: false,
    // Count unknown messages too; only the validated set-field whitelist reaches the result.
    includeUnknownData: true,
    mesgDefinitionListener: countRecord,
    mesgListener: (number, message) => {
      countRecord();

      if (number === Profile.MesgNum.SET) {
        setCount += 1;
        const set = setMessage.parse(message);
        exerciseCount += Math.max(set.category?.length ?? 0, set.categorySubtype?.length ?? 0);

        if (setCount > MAX_STRENGTH_SETS || exerciseCount > MAX_EXERCISE_ENTRIES) {
          limitExceeded = true;
          throw new Error("FIT decode limit exceeded.");
        }

        recordedSets.push(set);
      }
    },
  });

  if (limitExceeded) {
    throw new Error(
      "The FIT file exceeds 25,000 messages including definitions, 2,000 set records, or 4,000 exercise entries.",
    );
  }

  if (decoded.errors.length > 0) {
    throw new Error("The FIT file could not be decoded completely; no partial sets were returned.");
  }

  const fileIds = decoded.messages.fileIdMesgs;

  if (fileIds?.length !== 1 || fileIds[0]?.type !== 4) {
    throw new Error(
      "Provide one recorded FIT activity file, not a planned workout or other file type.",
    );
  }

  const sets = recordedSets.map(normalizeSet);

  return {
    source: "User-supplied FIT activity file",
    availability: sets.length > 0 ? "recorded_sets" : "no_recorded_sets",
    provenance:
      "Recorded FIT set messages only, not planned Training API targets. No Garmin activity ID association has been verified.",
    notes:
      "Null means missing or unknown, not zero. Rest is represented only by recorded rest sets, never inferred from gaps. Exercise names are FIT profile identifiers, not guaranteed Garmin Connect display labels. The file is not stored.",
    sets,
  };
}
