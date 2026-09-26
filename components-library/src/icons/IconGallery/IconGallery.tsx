import { useState, type ComponentType } from "react"
import {
  Pressable,
  Text,
  TextInput,
  View,
  type PressableProps,
  type TextInputProps,
  type TextProps,
  type ViewProps,
} from "react-native"
import { cn } from "../../utils/cn"
import { iconRegistry } from "../registry"

// see Button.tsx / README "Architecture boundaries" for why these are cast locally
const ClassNameView = View as ComponentType<ViewProps & { className?: string }>
const ClassNamePressable = Pressable as ComponentType<PressableProps & { className?: string }>
const ClassNameText = Text as ComponentType<TextProps & { className?: string }>
const ClassNameTextInput = TextInput as ComponentType<TextInputProps & { className?: string }>

// This package's tsconfig has no "dom" lib (RN has no DOM), so Navigator
// here is otherwise the empty stub @types/react ships for RN projects.
declare global {
  interface Navigator {
    clipboard: { writeText: (text: string) => Promise<void> }
  }
}

const COPIED_LABEL_TIMEOUT_MS = 1200

function matchesQuery(query: string, name: string, keywords: string[]) {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return true
  return (
    name.toLowerCase().includes(normalized) ||
    keywords.some((keyword) => keyword.includes(normalized))
  )
}

export function IconGallery() {
  const [query, setQuery] = useState("")
  const [copiedName, setCopiedName] = useState<string | null>(null)

  const results = iconRegistry.filter(({ name, keywords }) => matchesQuery(query, name, keywords))

  const handlePress = async (name: string) => {
    try {
      await navigator.clipboard.writeText(name)
    } catch {
      // clipboard access can be denied/unavailable; the "Copied!" label
      // below still gives feedback for the click itself
    }
    setCopiedName(name)
    setTimeout(() => {
      setCopiedName((current) => (current === name ? null : current))
    }, COPIED_LABEL_TIMEOUT_MS)
  }

  return (
    <ClassNameView className="gap-4 p-4">
      <ClassNameTextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Search icons by name or keyword..."
        accessibilityLabel="Search icons"
        className="rounded-lg border border-surface-muted bg-surface px-3 py-2 text-sm text-foreground"
      />
      <ClassNameText className="text-xs text-muted">
        {results.length} of {iconRegistry.length} icons
      </ClassNameText>
      <ClassNameView className="flex-row flex-wrap gap-3">
        {results.map(({ name, Component, keywords }) => (
          <ClassNamePressable
            key={name}
            accessibilityRole="button"
            accessibilityLabel={`Copy ${name}`}
            onPress={() => handlePress(name)}
            className="w-28 items-center gap-2 rounded-lg border border-surface-muted bg-surface p-3 text-foreground active:opacity-70"
          >
            <Component size={28} />
            <ClassNameText
              className="text-center text-xs font-medium text-foreground"
              numberOfLines={1}
            >
              {name}
            </ClassNameText>
            <ClassNameText
              className={cn(
                "text-center text-[10px] text-muted",
                copiedName === name && "text-brand",
              )}
              numberOfLines={1}
            >
              {copiedName === name ? "Copied!" : keywords.slice(0, 2).join(", ")}
            </ClassNameText>
          </ClassNamePressable>
        ))}
      </ClassNameView>
      {results.length === 0 ? (
        <ClassNameText className="text-sm text-muted">No icons match "{query}".</ClassNameText>
      ) : null}
    </ClassNameView>
  )
}
