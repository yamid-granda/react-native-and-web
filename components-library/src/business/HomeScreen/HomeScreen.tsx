import type { ComponentType } from "react"
import { Pressable, Text, View, type PressableProps, type TextProps } from "react-native"
import { useSessionStore } from "../AuthScreen/useSessionStore"

// see Button.tsx / README "Architecture boundaries" for why these are cast locally.
// The outer View is left as plain `View` because it carries no className beyond
// the ones that already type-check — see the note there.
const ClassNameText = Text as ComponentType<TextProps & { className?: string }>
const ClassNamePressable = Pressable as ComponentType<PressableProps & { className?: string }>

export type HomeScreenProps = {
  /**
   * Where "My Store" goes when the visitor is signed in.
   *
   * A prop rather than a route lookup: this screen is rendered by both apps from
   * this one file, and only each app knows its own router.
   */
  onOpenStore?: () => void
  /** Where "My Store" goes when there is no session. */
  onSignIn?: () => void
}

export function HomeScreen({ onOpenStore, onSignIn }: HomeScreenProps) {
  const user = useSessionStore((state) => (state.status === "authenticated" ? state.user : null))
  const signedIn = Boolean(user)

  function openStore() {
    if (signedIn) {
      onOpenStore?.()
    } else {
      onSignIn?.()
    }
  }

  return (
    <View
      testID="home-screen"
      className="min-h-screen flex-1 items-center justify-center gap-6 bg-background p-8"
    >
      {/* The entry point for My Store, rather than a fifth bottom-nav tab: the bar
          is already four items plus a theme slot, and mobile-application's
          tab-bar-position.e2e.ts guards its geometry. One row on a screen both
          apps already render identically is the one place a new top-level entry
          has to be written once. */}
      <ClassNamePressable
        testID="home-my-store"
        accessibilityRole="button"
        accessibilityLabel="My Store"
        onPress={openStore}
        className="w-full max-w-xs items-center gap-1 rounded-lg bg-surface p-4 active:bg-surface-muted"
      >
        <ClassNameText className="text-base font-semibold leading-6 text-foreground">
          {signedIn ? user?.storeName : "My Store"}
        </ClassNameText>
        <ClassNameText className="text-xs leading-4 text-muted">
          {signedIn ? "Manage your products" : "Sign in to sell"}
        </ClassNameText>
      </ClassNamePressable>
    </View>
  )
}