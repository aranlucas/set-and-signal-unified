import { getDefaultConfig } from "expo/metro-config";

const config = getDefaultConfig(import.meta.dirname);

config.resolver.assetExts.push("xml");

export default config;
