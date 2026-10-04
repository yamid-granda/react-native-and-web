import { useState, type ComponentType } from "react"
import {
  Pressable,
  Text,
  View,
  type PressableProps,
  type TextProps,
  type ViewProps,
} from "react-native"
import { cn } from "../../utils/cn"
import { iconRegistry } from "../registry"
import { Input } from "../../common/Input/Input"

// see Button.tsx / README "Architecture boundaries" for why these are cast locally
const ClassNameView = View as ComponentType<ViewProps & { className?: string }>
const ClassNamePressable = Pressable as ComponentType<PressableProps & { className?: string }>
const ClassNameText = Text as ComponentType<TextProps & { className?: string }>

const COPIED_LABEL_TIMEOUT_MS = 1200

function matchesQuery(query: string, name: string, keywords: string[]) {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return true
  return (
    name.toLowerCase().includes(normalized) ||
    keywords.some((keyword) => keyword.includes(normalized))
  )
}

export function IconsGallery() {
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
    <ClassNameView className="w-full gap-4 p-4">
      <Input
        value={query}
        onChangeText={setQuery}
        placeholder="Search icons by name or keyword..."
        accessibilityLabel="Search icons"
      />
      <ClassNameText className="text-xs text-muted">
        {results.length} of {iconRegistry.length} icons
      </ClassNameText>
      <ClassNameView className="w-full flex-row flex-wrap justify-start gap-3">
        {results.map(({ name, Component, keywords }) => (
          <ClassNamePressable
            key={name}
            accessibilityRole="button"
            accessibilityLabel={`Copy ${name}`}
            onPress={() => handlePress(name)}
            className="min-w-28 max-w-40 flex-1 items-center gap-2 rounded-lg border border-surface-muted bg-surface p-3 text-foreground active:opacity-70"
          >
            <Component size={28} />
            <ClassNameText className="text-center text-xs font-medium text-foreground">
              {name.replace(/Icon$/, "")}
            </ClassNameText>
            <ClassNameText
              className={cn("text-center text-xs text-muted", copiedName === name && "text-brand")}
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
