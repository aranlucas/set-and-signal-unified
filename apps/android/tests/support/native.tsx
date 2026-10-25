import { configureStorage } from "../../src/data/store";
import { loadState, saveState } from "./storage";

export { nativeCalls } from "../adapters/native-services";

export function configureTestNativeServices(): void {
  configureStorage({ loadState, saveState });
}
