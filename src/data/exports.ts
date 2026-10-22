import { Directory, File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import * as DocumentPicker from "expo-document-picker";
import { parseBackup } from "../domain/backup";
import { type AppState } from "../domain/workout";
import { toCSV } from "../domain/csv";

export async function exportData(
  state: AppState,
  format: "json" | "csv",
  share = false,
): Promise<string | null> {
  const mimeType = format === "json" ? "application/json" : "text/csv";
  const contents =
    format === "json" ? JSON.stringify(state, null, 2) : toCSV(state);
  const filename = `fivefold-${new Date().toISOString().replace(/[:.]/g, "-")}.${format}`;
  if (!share) {
    let directory: Directory;
    try {
      directory = await Directory.pickDirectoryAsync();
    } catch (error) {
      if (error instanceof Error && /cancel/i.test(error.message)) return null;
      throw error;
    }
    directory.createFile(filename, mimeType).write(contents);
    return `${format === "json" ? "Backup" : "CSV"} saved in your selected folder.`;
  }
  const file = new File(Paths.cache, filename);
  file.create({ overwrite: true });
  file.write(contents);
  if (!(await Sharing.isAvailableAsync()))
    throw new Error("Sharing is unavailable on this device.");
  await Sharing.shareAsync(file.uri, {
    mimeType,
    dialogTitle: "Save your Fivefold data",
  });
  return null;
}
export async function importData(): Promise<AppState | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: "*/*",
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled) return null;
  if ((result.assets[0].size ?? 0) > 20_000_000)
    throw new Error("This backup is too large (maximum 20 MB).");
  return parseBackup(await new File(result.assets[0].uri).text());
}
