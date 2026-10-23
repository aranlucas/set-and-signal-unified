import { useEffect, type ReactNode } from "react";
import { useWindowDimensions } from "react-native";
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
import { fillMaxWidth, paddingAll, weight } from "@expo/ui/jetpack-compose/modifiers";
import { roundedClip } from "./modifiers";

interface ChildrenProps {
  children: ReactNode;
}

interface PanelProps extends ChildrenProps {
  highlighted?: boolean;
}

interface HeadingProps extends ChildrenProps {
  large?: boolean;
}

interface StatRowProps {
  label: string;
  value: string;
}

interface ActionProps extends ChildrenProps {
  onPress: () => void;
  secondary?: boolean;
  subtle?: boolean;
  disabled?: boolean;
}

interface Choice<T> {
  value: T;
  label: string;
}

interface ChoicesProps<T extends string | number> {
  values: Choice<T>[];
  value: T;
  onChange: (value: T) => void;
}

interface FieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  numeric?: boolean;
  multiline?: boolean;
  error?: string;
  suffix?: string;
}

/** Readable column width on tablets and unfolded foldables. */
const MAX_CONTENT_WIDTH = 640;

/** Horizontal inset that keeps content in a centred column of at most 640 dp. */
export function useContentInset() {
  const { width } = useWindowDimensions();

  return Math.max(16, Math.round((width - MAX_CONTENT_WIDTH) / 2));
}

export function Page({ children }: ChildrenProps) {
  const inset = useContentInset();

  return (
    <LazyColumn
      modifiers={[weight(1), fillMaxWidth()]}
      contentPadding={{ start: inset, end: inset, top: 8, bottom: 24 }}
      verticalArrangement={{ spacedBy: 10 }}
    >
      {children}
    </LazyColumn>
  );
}

export function Panel({ children, highlighted = false }: PanelProps) {
  const c = useMaterialColors();

  return (
    <Card
      modifiers={[fillMaxWidth(), roundedClip(16)]}
      colors={{
        containerColor: highlighted ? c.primaryContainer : c.surfaceContainerLow,
      }}
    >
      <Column modifiers={[paddingAll(16), fillMaxWidth()]} verticalArrangement={{ spacedBy: 12 }}>
        {children}
      </Column>
    </Card>
  );
}

/** Card for edge-to-edge native ListItem rows (no inner padding). */
export function ListGroup({ children }: ChildrenProps) {
  const c = useMaterialColors();

  return (
    <Card
      modifiers={[fillMaxWidth(), roundedClip(16)]}
      colors={{ containerColor: c.surfaceContainerLow }}
    >
      <Column modifiers={[fillMaxWidth()]}>{children}</Column>
    </Card>
  );
}

export function Heading({ children, large = false }: HeadingProps) {
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

export function Caption({ children }: ChildrenProps) {
  const c = useMaterialColors();

  return (
    <Text color={c.onSurfaceVariant} style={{ typography: "bodyMedium" }}>
      {children}
    </Text>
  );
}

export function SectionTitle({ children }: ChildrenProps) {
  return <Text style={{ typography: "titleMedium", fontWeight: "600" }}>{children}</Text>;
}

export function Divider() {
  const c = useMaterialColors();

  return <HorizontalDivider color={c.outlineVariant} thickness={0.5} />;
}

export function StatRow({ label, value }: StatRowProps) {
  return (
    <Row
      modifiers={[fillMaxWidth()]}
      horizontalArrangement={{ spacedBy: 12 }}
      verticalAlignment="center"
    >
      <Column modifiers={[weight(1)]}>
        <Caption>{label}</Caption>
      </Column>
      <Text style={{ typography: "titleSmall" }}>{value}</Text>
    </Row>
  );
}

export function Action({ children, onPress, secondary, subtle, disabled }: ActionProps) {
  const Control = subtle ? TextButton : secondary ? FilledTonalButton : Button;

  return (
    <Control onClick={onPress} enabled={!disabled} modifiers={[fillMaxWidth()]}>
      <Text>{children}</Text>
    </Control>
  );
}

export function Choices<T extends string | number>({ values, value, onChange }: ChoicesProps<T>) {
  if (values.length <= 3) {
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
  }

  return (
    <FlowRow horizontalArrangement={{ spacedBy: 8 }} verticalArrangement={{ spacedBy: 4 }}>
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
}: FieldProps) {
  const text = useNativeState(value);
  useEffect(() => {
    if (text.get() !== value) {
      text.set(value);
    }
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
