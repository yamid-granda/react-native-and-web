import type { ComponentType } from "react"
import { Pressable, Text, type PressableProps, type TextProps } from "react-native"
import { cn } from "../../utils/cn"

// nativewind's className typing doesn't cover PressableProps and doesn't
// merge reliably across workspace packages (README), so cast locally.
const ClassNamePressable = Pressable as ComponentType<PressableProps & { className?: string }>
const ClassNameText = Text as ComponentType<TextProps & { className?: string }>

export type ButtonProps = {
  label: string
  onPress?: () => void
  className?: string
}

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
  )
}
