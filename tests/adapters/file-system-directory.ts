import { File } from "./file-system-file";
import { fileContents, fileMimeTypes } from "./file-system-state";

export class Directory {
  readonly uri: string;

  constructor(...parts: string[]) {
    this.uri = parts.join("/");
  }

  static pickDirectoryAsync(): Promise<Directory> {
    return Promise.reject(new Error("Directory picking is unavailable in tests."));
  }

  createFile(name: string, mimeType: string | null): File {
    const file = new File(`${this.uri}/${name}`);
    fileContents.set(file.uri, "");
    fileMimeTypes.set(file.uri, mimeType);

    return file;
  }
}
