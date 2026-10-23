interface ModifierDescriptor {
  name: string;
  args: unknown[];
}

type ModifierFactory = (...args: unknown[]) => ModifierDescriptor;

const createModifier =
  (name: string): ModifierFactory =>
  (...args) => ({ name, args });

export const background = createModifier("background");

export const fillMaxSize = createModifier("fillMaxSize");

export const fillMaxWidth = createModifier("fillMaxWidth");

export const verticalScroll = createModifier("verticalScroll");

export const paddingAll = createModifier("paddingAll");

export const padding = createModifier("padding");

export const clip = createModifier("clip");

export const weight = createModifier("weight");

export const size = createModifier("size");

export const defaultMinSize = createModifier("defaultMinSize");

export const semantics = createModifier("semantics");

export const height = createModifier("height");

export const width = createModifier("width");

export const clickable = createModifier("clickable");

export const toggleable = createModifier("toggleable");

export const selectableGroup = createModifier("selectableGroup");

const modifierPresets = { RoundedCorner: createModifier("RoundedCorner") };

export { modifierPresets as "Shapes" };
