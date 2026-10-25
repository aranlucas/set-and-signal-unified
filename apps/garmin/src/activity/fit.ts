import { Decoder, Profile, Stream, Utils, type Mesg, type FitMessages } from "@garmin/fitsdk";
import { z } from "zod";

export const MAX_FIT_BYTES = 1024 * 1024;

export const MAX_FIT_MESSAGES = 25_000;

export const MAX_STRENGTH_SETS = 2_000;

export const MAX_EXERCISE_ENTRIES = 4_000;

export const MAX_DECODED_FIT_BYTES = 8 * 1024 * 1024;

const jsonRecord = z.record(z.string(), z.json());

// SDK messages contain 64-bit integers. JSON has no lossless numeric representation
// for them, so use native JSON serialization with decimal strings at that boundary.
function fitJson(value: Mesg | FitMessages) {
  return jsonRecord.parse(
    JSON.parse(
      JSON.stringify(
        value,
        // oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof -- Native JSON replacers visit arbitrary SDK field values, including bigint; decimal strings avoid precision loss.
        (_key, item: unknown) => (typeof item === "bigint" ? item.toString() : item),
      ),
    ),
  );
}

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

/** Decode every SDK message and field; normalize recorded strength sets as a convenience. */
export function decodeActivityFile(input: Uint8Array) {
  if (input.length === 0 || input.length > MAX_FIT_BYTES) {
    throw new Error("Provide one FIT activity file up to 1 MiB.");
  }

  const bytes = Buffer.from(input);
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
  let decodedBytes = 0;

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
    expandSubFields: true,
    expandComponents: true,
    mergeHeartRates: false,
    // Preserve unknown messages/fields and developer fields alongside standard FIT data.
    includeUnknownData: true,
    mesgDefinitionListener: countRecord,
    mesgListener: (number, message) => {
      countRecord();
      decodedBytes += Buffer.byteLength(JSON.stringify(fitJson(message)), "utf8");

      if (decodedBytes > MAX_DECODED_FIT_BYTES) {
        limitExceeded = true;
        throw new Error("Decoded FIT output limit exceeded.");
      }

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
      "The FIT file exceeds 25,000 messages including definitions, 2,000 set records, 4,000 exercise entries, or 8 MiB of decoded data.",
    );
  }

  if (decoded.errors.length > 0) {
    throw new Error(
      "The FIT file could not be decoded completely; no partial messages were returned.",
    );
  }

  const fileIds = decoded.messages.fileIdMesgs;

  if (fileIds?.length !== 1 || fileIds[0]?.type !== 4) {
    throw new Error(
      "Provide one recorded FIT activity file, not a planned workout or other file type.",
    );
  }

  const sets = recordedSets.map(normalizeSet);

  const output = {
    source: "Garmin Activity API FIT file",
    availability: "available",
    profileVersion: decoded.profileVersion,
    messages: fitJson(decoded.messages),
    strengthAvailability: sets.length > 0 ? "recorded_sets" : "no_recorded_sets",
    sets,
    encoding: {
      numericValues: "FIT profile scale and offset applied; coordinates remain semicircles.",
      timestamps:
        "FIT epoch seconds since 1989-12-31T00:00:00Z; relative timestamps remain relative.",
      enumerations: "Numeric FIT profile IDs; unknown fields retain their numeric keys.",
      integers64Bit: "Decimal strings, preserving precision.",
    },
    notes:
      "All SDK-decoded message types and fields are included, including developer fields. Recorded order is preserved within each message type. Null or omitted values are unavailable, not zero. The sets view normalizes recorded strength sets; rest is never inferred. Workout steps describe plans, not proof of performance. Original files may omit later Garmin Connect edits.",
  };

  if (Buffer.byteLength(JSON.stringify(output), "utf8") > MAX_DECODED_FIT_BYTES) {
    throw new Error("Decoded FIT data exceeds 8 MiB; no partial messages were returned.");
  }

  return output;
}
