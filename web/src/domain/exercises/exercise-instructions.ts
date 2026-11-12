import * as validation from "valibot";
import { useEffect, useState } from "react";
import { LANGUAGES, normalizeLanguage, type Language } from "@/i18n/languages";
import { instructionShard } from "@/domain/exercises/instruction-shard";

type LoadedValue = { requestKey: string; result: LoadedExerciseInstructions };

type InstructionPack = Readonly<Record<string, readonly string[]>>;

export type LoadedExerciseInstructions = {
  steps: readonly string[];
  language: Language;
};

const packCache = new Map<string, Promise<InstructionPack>>();

const EMPTY_INSTRUCTIONS: LoadedExerciseInstructions = { steps: [], language: "en" };

const instructionPackSchema = validation.record(
  validation.string(),
  validation.array(validation.string()),
);

const isInstructionPack = (value: unknown): value is InstructionPack =>
  validation.is(instructionPackSchema, value);

export function instructionPackPath(language: Language, exerciseId: string): string {
  const shard = instructionShard(exerciseId);

  return `instructions/${language}/instructions-${language}-${shard}.json`;
}

function instructionPackURL(language: Language, exerciseId: string): URL {
  const baseURL = typeof document === "undefined" ? "http://localhost/" : document.baseURI;

  return new URL(instructionPackPath(language, exerciseId), baseURL);
}

function loadInstructionPack(language: Language, exerciseId: string): Promise<InstructionPack> {
  const shard = instructionShard(exerciseId);
  const cacheKey = `${language}/${shard}`;
  const cached = packCache.get(cacheKey);

  if (cached) {
    return cached;
  }

  const pending = fetch(instructionPackURL(language, exerciseId), {
    credentials: "same-origin",
  })
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`Instruction shard request failed: ${response.status}`);
      }

      const pack: unknown = await response.json();

      if (!isInstructionPack(pack)) {
        throw new Error(`Instruction shard is invalid: ${cacheKey}`);
      }

      return pack;
    })
    .catch((cause: unknown) => {
      if (packCache.get(cacheKey) === pending) {
        packCache.delete(cacheKey);
      }

      throw cause;
    });

  packCache.set(cacheKey, pending);

  return pending;
}

async function instructionsFor(
  language: Language,
  exerciseId: string,
): Promise<readonly string[] | undefined> {
  const pack = await loadInstructionPack(language, exerciseId);

  return pack[exerciseId];
}

export async function loadExerciseInstructions(
  language: string,
  exerciseId: string,
): Promise<LoadedExerciseInstructions> {
  const preferredLanguage = normalizeLanguage(language);

  if (LANGUAGES[preferredLanguage].hasExercises) {
    try {
      const translated = await instructionsFor(preferredLanguage, exerciseId);

      if (translated) {
        return { steps: translated, language: preferredLanguage };
      }
    } catch {
      // A missing translated shard should not make the exercise detail unusable.
    }
  }

  if (preferredLanguage !== "en") {
    try {
      const english = await instructionsFor("en", exerciseId);

      if (english) {
        return { steps: english, language: "en" };
      }
    } catch {
      // The hook renders an empty state when neither pack can be loaded.
    }
  }

  return EMPTY_INSTRUCTIONS;
}

export function preloadExerciseInstructions(language: string, exerciseId: string): void {
  void loadExerciseInstructions(language, exerciseId).catch(() => {});
}

export function useExerciseInstructions(
  language: string,
  exerciseId: string,
  enabled: boolean,
): LoadedExerciseInstructions | undefined {
  const normalizedLanguage = normalizeLanguage(language);
  const requestKey = `${normalizedLanguage}/${exerciseId}`;

  const [loaded, setLoaded] = useState<LoadedValue | undefined>();

  useEffect((): (() => void) | undefined => {
    if (!enabled) {
      return undefined;
    }

    let active = true;
    void loadExerciseInstructions(normalizedLanguage, exerciseId)
      .then((result): undefined => {
        if (active) {
          setLoaded({ requestKey, result });
        }
      })
      .catch(() => {
        if (active) {
          setLoaded({ requestKey, result: EMPTY_INSTRUCTIONS });
        }
      });

    return () => {
      active = false;
    };
  }, [enabled, exerciseId, normalizedLanguage, requestKey]);

  if (!enabled) {
    return EMPTY_INSTRUCTIONS;
  }

  return loaded?.requestKey === requestKey ? loaded.result : undefined;
}
