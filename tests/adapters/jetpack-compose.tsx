import {
  createElement,
  Fragment,
  isValidElement,
  useImperativeHandle,
  useState,
  type HTMLAttributes,
  type ReactNode,
  type Ref,
} from "react";
import { nativeCalls, type SnackbarMessage } from "./native-services";

interface HostProps {
  children?: ReactNode;
}

type HostComponent = (
  props: HostProps & HTMLAttributes<HTMLDivElement>,
) => ReturnType<typeof createElement>;

interface LazyItem<T> {
  item: T;
  index: number;
}

interface LazyItemsProps<T> extends Omit<HostProps, "children"> {
  data: readonly T[];
  keyExtractor(this: void, item: T, index: number): string | number;
  children(this: void, value: LazyItem<T>): ReactNode;
}

interface MaterialColors {
  background: string;
  primary: string;
  onPrimary: string;
  primaryContainer: string;
  onPrimaryContainer: string;
  secondaryContainer: string;
  surfaceContainerLow: string;
  surfaceContainerHighest: string;
  onSurface: string;
  onSurfaceVariant: string;
  outlineVariant: string;
  error: string;
  errorContainer: string;
  onErrorContainer: string;
}

interface NativeState<T> {
  get(): T;
  set(value: T): void;
  value: T;
}

interface SnackbarHandle {
  showSnackbar(message: SnackbarMessage): Promise<string>;
}

interface SnackbarHostProps extends HostProps {
  ref?: Ref<SnackbarHandle>;
}

interface TextElementProps {
  children?: ReactNode;
}

const componentNames = new Map<unknown, string>();

function host(name: string): HostComponent {
  const Host: HostComponent = ({ children, ...props }) => createElement(name, props, children);
  componentNames.set(Host, name);

  return Host;
}

function renderLazyItems<T>({ data, children, keyExtractor }: LazyItemsProps<T>) {
  return createElement(
    "LazyColumn.Items",
    {},
    data.map((item, index) =>
      createElement(
        "LazyColumn.Item",
        { key: keyExtractor(item, index) },
        children({ item, index }),
      ),
    ),
  );
}

function validateTextChildren(children: ReactNode): void {
  if (children === null || children === undefined || children === true || children === false) {
    return;
  }

  if (Array.isArray(children)) {
    // SAFETY: Array.isArray narrows ReactNode to an array of its ReactNode elements.
    const nodes = children as ReactNode[];

    for (const child of nodes) {
      validateTextChildren(child);
    }

    return;
  }

  if (!isValidElement<TextElementProps>(children)) {
    return;
  }

  if (children.type === Text) {
    validateTextChildren(children.props.children);

    return;
  }

  const type = children.type;

  const componentText = String(type);
  const declaredName = /^function\s+([^\s(]+)/.exec(componentText)?.[1];

  const name =
    type === Fragment ? "Fragment" : (componentNames.get(type) ?? declaredName ?? componentText);

  throw new Error(`Unsupported child element of type "${name}" inside <Text>`);
}

export const AlertDialog = Object.assign(host("AlertDialog"), {
  Title: host("AlertDialog.Title"),
  Text: host("AlertDialog.Text"),
  ConfirmButton: host("AlertDialog.ConfirmButton"),
  DismissButton: host("AlertDialog.DismissButton"),
});

export const Button = host("Button");

export const Card = host("Card");

export const Column = host("Column");

export const FilledTonalButton = host("FilledTonalButton");

export const FilterChip = Object.assign(host("FilterChip"), { Label: host("FilterChip.Label") });

export const FlowRow = host("FlowRow");

export const HorizontalDivider = host("HorizontalDivider");

export const Host = host("Host");

export const Icon = host("Icon");

export const IconButton = host("IconButton");

export const LinearProgressIndicator = host("LinearProgressIndicator");

export const ListItem = Object.assign(host("ListItem"), {
  HeadlineContent: host("ListItem.HeadlineContent"),
  SupportingContent: host("ListItem.SupportingContent"),
  TrailingContent: host("ListItem.TrailingContent"),
});

export const ModalBottomSheet = host("ModalBottomSheet");

export const NavigationBar = host("NavigationBar");

export const NavigationBarItem = Object.assign(host("NavigationBarItem"), {
  Icon: host("NavigationBarItem.Icon"),
  Label: host("NavigationBarItem.Label"),
});

export const OutlinedTextField = Object.assign(host("OutlinedTextField"), {
  Label: host("OutlinedTextField.Label"),
  Suffix: host("OutlinedTextField.Suffix"),
  SupportingText: host("OutlinedTextField.SupportingText"),
});

export const Row = host("Row");

export const SegmentedButton = Object.assign(host("SegmentedButton"), {
  Label: host("SegmentedButton.Label"),
});

export const SingleChoiceSegmentedButtonRow = host("SingleChoiceSegmentedButtonRow");

export const Spacer = host("Spacer");

export const Switch = host("Switch");

export const TextButton = host("TextButton");

export const TopAppBar = Object.assign(host("TopAppBar"), {
  Title: host("TopAppBar.Title"),
  NavigationIcon: host("TopAppBar.NavigationIcon"),
  Actions: host("TopAppBar.Actions"),
});

export const LazyColumn = Object.assign(host("LazyColumn"), {
  Items: renderLazyItems,
});

export const Text: HostComponent = ({ children, ...props }) => {
  validateTextChildren(children);

  return createElement("Text", props, children);
};

componentNames.set(Text, "Text");

const materialColors: MaterialColors = {
  background: "color-background",
  primary: "color-primary",
  onPrimary: "color-onPrimary",
  primaryContainer: "color-primaryContainer",
  onPrimaryContainer: "color-onPrimaryContainer",
  secondaryContainer: "color-secondaryContainer",
  surfaceContainerLow: "color-surfaceContainerLow",
  surfaceContainerHighest: "color-surfaceContainerHighest",
  onSurface: "color-onSurface",
  onSurfaceVariant: "color-onSurfaceVariant",
  outlineVariant: "color-outlineVariant",
  error: "color-error",
  errorContainer: "color-errorContainer",
  onErrorContainer: "color-onErrorContainer",
};

export function useMaterialColors(): MaterialColors {
  return materialColors;
}

export function useNativeState<T>(initial: T): NativeState<T> {
  return useState<NativeState<T>>(() => {
    let value = initial;

    return {
      get: () => value,
      set: (next) => {
        value = next;
      },
      get value() {
        return value;
      },
    };
  })[0];
}

export function SnackbarHost({ ref, ...props }: SnackbarHostProps) {
  useImperativeHandle(
    ref,
    () => ({ showSnackbar: (message) => nativeCalls.showSnackbar(message) }),
    [],
  );

  return createElement("SnackbarHost", props);
}
