import { useState } from "react"
import {
  KeyboardAvoidingView,
  ScrollView,
  Text,
  View,
  type ScrollViewProps,
  type TextProps,
  type ViewProps,
} from "react-native"
import type { ComponentProps, ComponentType } from "react"
import { Button } from "../../common/Button/Button"
import { Input } from "../../common/Input/Input"
import { Label } from "../../common/Label/Label"
import { useSessionStore } from "./useSessionStore"
import type { AuthSession } from "../../types/Store"

// see Button.tsx / README "Architecture boundaries" for why these are cast locally
const ClassNameScrollView = ScrollView as ComponentType<ScrollViewProps & { className?: string }>
const ClassNameView = View as ComponentType<ViewProps & { className?: string }>
const ClassNameText = Text as ComponentType<TextProps & { className?: string }>
const ClassNameKeyboardAvoidingView = KeyboardAvoidingView as ComponentType<
  ComponentProps<typeof KeyboardAvoidingView> & { className?: string }
>

export type AuthMode = "sign-in" | "sign-up"

export type AuthScreenProps = {
  /** Extra message under the title — "Please sign in to continue", typically. */
  subtitle?: string
  /** Called after a successful register or login, with the new session. */
  onAuthenticated?: (session: AuthSession) => void
  /** Injected so this screen owns no api layer (see useRequireSession). */
  onSubmit: (input: AuthInput) => Promise<AuthSession>
}

/**
 * The one payload the screen needs, for both modes.
 *
 * `storeName` is only read in sign-up mode; `AuthScreen` does not validate it
 * beyond being non-empty, because the server is the authority on the length
 * limits and duplicating those here would be a second thing to keep in sync.
 */
export type AuthInput = {
  email: string
  password: string
  storeName?: string
}

// Deliberately duplicated from the server's rules (api-rs/src/handlers/auth.rs):
// a password under 8 characters is refused there, and telling the user here
// saves a round trip. The server stays the authority.
const MIN_PASSWORD_LENGTH = 8
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function AuthScreen({ subtitle, onAuthenticated, onSubmit }: AuthScreenProps) {
  const setSession = useSessionStore((state) => state.setSession)
  const [mode, setMode] = useState<AuthMode>("sign-in")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [storeName, setStoreName] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const isSignUp = mode === "sign-up"

  async function submit() {
    const problem = validate({ mode, email, password, storeName })
    if (problem) {
      setError(problem)
      return
    }
    setError(null)
    setIsSubmitting(true)
    try {
      const session = await onSubmit({
        email: email.trim(),
        password,
        storeName: isSignUp ? storeName.trim() : undefined,
      })
      setSession(session)
      onAuthenticated?.(session)
    } catch (cause) {
      setError(messageFor(cause))
    } finally {
      setIsSubmitting(false)
    }
  }

  function switchMode(next: AuthMode) {
    setMode(next)
    setError(null)
  }

  return (
    <ClassNameKeyboardAvoidingView className="flex-1 bg-background" behavior="padding">
      <ClassNameScrollView testID="auth-screen" className="flex-1 bg-background">
        <ClassNameView className="gap-4 p-6">
          <ClassNameView className="gap-1">
            <ClassNameText testID="auth-title" className="text-2xl font-semibold text-foreground">
              {isSignUp ? "Open your store" : "Sign in"}
            </ClassNameText>
            {subtitle ? (
              <ClassNameText className="text-sm text-muted">{subtitle}</ClassNameText>
            ) : null}
          </ClassNameView>

          <ClassNameView className="gap-1">
            <Label htmlFor="auth-email">Email</Label>
            <Input
              inputTestID="auth-email"
              value={email}
              onChangeText={setEmail}
              placeholder="seller@example.com"
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
            />
          </ClassNameView>

          <ClassNameView className="gap-1">
            <Label htmlFor="auth-password">Password</Label>
            <Input
              inputTestID="auth-password"
              value={password}
              onChangeText={setPassword}
              placeholder="At least 8 characters"
              secureTextEntry
              autoCapitalize="none"
              autoComplete={isSignUp ? "new-password" : "current-password"}
            />
          </ClassNameView>

          {isSignUp ? (
            <ClassNameView className="gap-1">
              <Label htmlFor="auth-store-name">Store name</Label>
              <Input
                inputTestID="auth-store-name"
                value={storeName}
                onChangeText={setStoreName}
                placeholder="Riverbend Vintage"
              />
            </ClassNameView>
          ) : null}

          {error ? (
            <ClassNameText testID="auth-error" className="text-sm text-brand">
              {error}
            </ClassNameText>
          ) : null}

          <Button
            label={isSignUp ? "Create store" : "Sign in"}
            testId="auth-submit"
            onPress={submit}
            loading={isSubmitting}
          />

          <ClassNameText className="text-sm text-muted">
            {isSignUp ? "Already selling here?" : "New to the marketplace?"}
          </ClassNameText>
          <Button
            label={isSignUp ? "Sign in instead" : "Create a store"}
            testId="auth-switch-mode"
            onPress={() => switchMode(isSignUp ? "sign-in" : "sign-up")}
            variant="secondary"
          />
        </ClassNameView>
      </ClassNameScrollView>
    </ClassNameKeyboardAvoidingView>
  )
}

/**
 * `null` when the form is submittable.
 *
 * Exported so the app-level tests can assert the same rules without driving the
 * whole screen — a form's validation is worth testing without a rendering.
 */
export function validate(input: {
  mode: AuthMode
  email: string
  password: string
  storeName: string
}): string | null {
  const email = input.email.trim()
  if (!email) return "Email is required"
  if (!EMAIL_PATTERN.test(email)) return "Enter a valid email address"
  if (!input.password) return "Password is required"
  if (input.password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`
  }
  if (input.mode === "sign-up" && !input.storeName.trim()) return "Store name is required"
  return null
}

/**
 * Turns whatever the api layer threw into one line.
 *
 * A 401 from `/auth/login` is deliberately vague: the server answers identically
 * for a wrong password and an unknown address, so the client cannot say more
 * than "those credentials did not work" either.
 */
export function messageFor(cause: unknown): string {
  if (cause instanceof Error && cause.message) return cause.message
  return "Something went wrong. Please try again."
}