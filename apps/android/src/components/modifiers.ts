import * as modifierExports from "@expo/ui/jetpack-compose/modifiers";

export function roundedClip(radius: number) {
  return modifierExports.clip(modifierExports.Shapes.RoundedCorner(radius));
}
