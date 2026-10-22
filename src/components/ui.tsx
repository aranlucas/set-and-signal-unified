import { useEffect, type ReactNode } from "react";
import {
  Button,
  Card,
  Column,
  FilledTonalButton,
  FlowRow,
  Row,
  HorizontalDivider,
  SegmentedButton,
  SingleChoiceSegmentedButtonRow,
  LazyColumn,
  OutlinedTextField,
  Text,
  TextButton,
  useMaterialColors,
  useNativeState,
} from "@expo/ui/jetpack-compose";
import {
  fillMaxWidth,
  paddingAll,
  clip,
  Shapes,
  weight,
} from "@expo/ui/jetpack-compose/modifiers";

export function Page({ children }: { children: ReactNode }) {
  return (
    <LazyColumn
      modifiers={[weight(1), fillMaxWidth()]}
      contentPadding={{ start: 16, end: 16, top: 8, bottom: 24 }}
      verticalArrangement={{ spacedBy: 10 }}
    >
      {children}
    </LazyColumn>
  );
}
export function Panel({
  children,
  highlighted = false,
}: {
  children: ReactNode;
  highlighted?: boolean;
}) {
  const c = useMaterialColors();
  return (
    <Card
      modifiers={[fillMaxWidth(), clip(Shapes.RoundedCorner(16))]}
      colors={{
        containerColor: highlighted
          ? c.primaryContainer
          : c.surfaceContainerLow,
      }}
    >
      <Column
        modifiers={[paddingAll(16), fillMaxWidth()]}
        verticalArrangement={{ spacedBy: 12 }}
      >
        {children}
      </Column>
    </Card>
  );
}
export function Heading({
  children,
  large = false,
}: {
  children: ReactNode;
  large?: boolean;
}) {
  return (
    <Text
      style={{
        typography: large ? "headlineSmall" : "titleLarge",
        fontWeight: "600",
      }}
    >
      {children}
    </Text>
  );
}
export function Caption({ children }: { children: ReactNode }) {
  const c = useMaterialColors();
  return (
    <Text color={c.onSurfaceVariant} style={{ typography: "bodyMedium" }}>
      {children}
    </Text>
  );
}
export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <Text style={{ typography: "titleMedium", fontWeight: "600" }}>
      {children}
    </Text>
  );
}
export function Divider() {
  const c = useMaterialColors();
  return <HorizontalDivider color={c.outlineVariant} thickness={0.5} />;
}
export function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <Row
      modifiers={[fillMaxWidth()]}
      horizontalArrangement="spaceBetween"
      verticalAlignment="center"
    >
      <Caption>{label}</Caption>
      <Text style={{ typography: "titleSmall" }}>{value}</Text>
    </Row>
  );
}
export function Action({
  children,
  onPress,
  secondary,
  subtle,
  disabled,
}: {
  children: ReactNode;
  onPress: () => void;
  secondary?: boolean;
  subtle?: boolean;
  disabled?: boolean;
}) {
  const Control = subtle ? TextButton : secondary ? FilledTonalButton : Button;
  return (
    <Control onClick={onPress} enabled={!disabled} modifiers={[fillMaxWidth()]}>
      <Text>{children}</Text>
    </Control>
  );
}
export function Choices<T extends string | number>({
  values,
  value,
  onChange,
}: {
  values: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  if (values.length <= 3)
    return (
      <SingleChoiceSegmentedButtonRow modifiers={[fillMaxWidth()]}>
        {values.map((o) => (
          <SegmentedButton
            key={o.value}
            selected={o.value === value}
            onClick={() => onChange(o.value)}
          >
            <SegmentedButton.Label>
              <Text>{o.label}</Text>
            </SegmentedButton.Label>
          </SegmentedButton>
        ))}
      </SingleChoiceSegmentedButtonRow>
    );
  return (
    <FlowRow
      horizontalArrangement={{ spacedBy: 8 }}
      verticalArrangement={{ spacedBy: 4 }}
    >
      {values.map((o) => {
        const Control = o.value === value ? Button : FilledTonalButton;
        return (
          <Control key={o.value} onClick={() => onChange(o.value)}>
            <Text>{o.label}</Text>
          </Control>
        );
      })}
    </FlowRow>
  );
}
export function Field({
  label,
  value,
  onChange,
  numeric = false,
  multiline = false,
  error,
  suffix,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  numeric?: boolean;
  multiline?: boolean;
  error?: string;
  suffix?: string;
}) {
  const text = useNativeState(value);
  useEffect(() => {
    if (text.get() !== value) text.set(value);
  }, [value, text]);
  return (
    <OutlinedTextField
      value={text}
      onValueChange={onChange}
      singleLine={!multiline}
      maxLines={multiline ? 5 : 1}
      maxLength={multiline ? 2000 : 30}
      isError={!!error}
      keyboardOptions={{
        keyboardType: numeric ? "decimal" : "text",
        imeAction: multiline ? "default" : "done",
        capitalization: numeric ? "none" : "sentences",
      }}
      modifiers={[fillMaxWidth()]}
    >
      <OutlinedTextField.Label>
        <Text>{label}</Text>
      </OutlinedTextField.Label>
      {suffix ? (
        <OutlinedTextField.Suffix>
          <Text>{suffix}</Text>
        </OutlinedTextField.Suffix>
      ) : null}
      {error ? (
        <OutlinedTextField.SupportingText>
          <Text>{error}</Text>
        </OutlinedTextField.SupportingText>
      ) : null}
    </OutlinedTextField>
  );
}
