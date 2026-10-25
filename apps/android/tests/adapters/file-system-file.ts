import type { FileCreateOptions, FileWriteOptions } from "expo-file-system";
import { fileContents } from "./file-system-state";

export class File {
  readonly uri: string;

  constructor(...parts: string[]) {
    this.uri = parts.join("/");
  }

  create(options: FileCreateOptions = {}): void {
    if (!options.overwrite && fileContents.has(this.uri)) {
      throw new Error(`File already exists: ${this.uri}`);
    }

    fileContents.set(this.uri, "");
  }

  write(contents: string | Uint8Array, options: FileWriteOptions = {}): void {
    const value = Buffer.from(contents).toString();
    const previous = options.append ? (fileContents.get(this.uri) ?? "") : "";
    fileContents.set(this.uri, `${previous}${value}`);
  }

  text(): Promise<string> {
    return Promise.resolve(fileContents.get(this.uri) ?? "");
  }
}
