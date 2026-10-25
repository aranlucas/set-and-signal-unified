import * as performance from "./src/perf";
import { registerRootComponent } from "expo";

import App from "./app";

// Evaluate the opt-in startup clock before rendering without dropping the module binding.
void performance;

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
