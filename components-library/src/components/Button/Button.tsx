import type { ComponentType } from "react";
import { Pressable, Text, type PressableProps, type TextProps } from "react-native";
import { cn } from "../../utils/cn";

// nativewind's ambient `className` augmentation for react-native's prop
// types (react-native-css-interop/types) doesn't cover PressableProps, and
// more generally doesn't reliably merge across pnpm workspace packages that
// resolve to physically different react-native instances (differing peer
// hashes, e.g. mobile-application's Metro/Expo-influenced peer graph vs.
// components-library's own) — so this casts locally instead of relying on
// module augmentation working end to end.
const ClassNamePressable = Pressable as ComponentType<PressableProps & { className?: string }>;
const ClassNameText = Text as ComponentType<TextProps & { className?: string }>;

export type ButtonProps = {
  label: string;
  onPress?: () => void;
  className?: string;
};

/**
 * Cross-platform button. Built from React Native primitives so the exact
 * same implementation renders on web (via react-native-web, inside Next.js)
 * and on native (via Expo) — the core mechanism this library uses to
 * maximize sharing between the two apps.
 */
export function Button({ label, onPress, className }: ButtonProps) {
  return (
    <ClassNamePressable
      accessibilityRole="button"
      onPress={onPress}
      className={cn(
        "items-center justify-center rounded-lg bg-brand px-4 py-3 active:bg-brand-dark",
        className,
      )}
    >
      <ClassNameText className="text-base font-semibold text-white">{label}</ClassNameText>
    </ClassNamePressable>
  );
}
