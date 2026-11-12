import { translate } from "@/i18n/translate";
import { toast } from "@/shared/lib/toast";
import { parseImport } from "@/features/settings/import-csv";
import type { ParseResult } from "@/features/settings/import-csv";
import { getAppState } from "@/features/exercises/sheet-shared";

export type ParsedImport = Exclude<ParseResult, { error: string }>;

export function importFromApp(file: File, onParsed: (parsed: ParsedImport) => void): void {
  void file
    .text()
    .then((contents): undefined => {
      let parsed: ParseResult;

      try {
        parsed = parseImport(contents, { unit: getAppState().unit });
      } catch {
        toast(translate("import.couldNotReadFile", "Could not read that file"));

        return;
      }

      if ("error" in parsed) {
        if (parsed.error === "empty") {
          toast(translate("import.fileEmpty", "That file is empty"));

          return;
        }

        toast(
          translate(
            "import.fileSColumnsArenT",
            "That file's columns aren't recognised — see the docs for supported apps.",
          ),
        );

        return;
      }

      if (
        parsed.kind === "bodyweight" ? parsed.bodyweight.length === 0 : parsed.workouts.length === 0
      ) {
        toast(translate("import.nothingImportFile", "Nothing to import from that file"));

        return;
      }

      onParsed(parsed);
    })
    .catch(() => toast(translate("import.couldNotReadFile", "Could not read that file")));
}
