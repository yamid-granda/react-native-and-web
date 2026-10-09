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
import { FormField } from "../../common/FormField/FormField"
import { ScreenHeader } from "../../common/ScreenHeader/ScreenHeader"
import { useSessionStore } from "./useSessionStore"
import type { AuthSession } from "../../types/Store"
import { useLocale, useT } from "../../i18n/LocaleContext"
import { en } from "../../i18n/en"
import { es } from "../../i18n/es"
import type { Locale } from "../../i18n/resolveLocale"

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
  const t = useT()
  const { locale } = useLocale()
  const [mode, setMode] = useState<AuthMode>("sign-in")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [storeName, setStoreName] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const isSignUp = mode === "sign-up"

  async function submit() {
    const problem = validate({ mode, email, password, storeName }, locale)
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
      setError(messageFor(cause, locale))
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
        <ScreenHeader
          title={isSignUp ? t("authOpenStore") : t("authSignIn")}
          subtitle={subtitle}
          testID="auth-title"
        />
        <ClassNameView className="gap-4 px-6 pb-6">

          <FormField
            label={t("authEmail")}
            inputTestID="auth-email"
            value={email}
            onChangeText={setEmail}
            placeholder={t("authEmailPlaceholder")}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
          />

          <FormField
            label={t("authPassword")}
            inputTestID="auth-password"
            value={password}
            onChangeText={setPassword}
            placeholder={t("authPasswordPlaceholder")}
            secureTextEntry
            autoCapitalize="none"
            autoComplete={isSignUp ? "new-password" : "current-password"}
          />

          {isSignUp ? (
            <FormField
              label={t("authStoreName")}
              inputTestID="auth-store-name"
              value={storeName}
              onChangeText={setStoreName}
              placeholder={t("authStoreNamePlaceholder")}
            />
          ) : null}

          {error ? (
            <ClassNameText testID="auth-error" className="text-sm text-brand">
              {error}
            </ClassNameText>
          ) : null}

          <Button
            label={isSignUp ? t("authCreateStore") : t("authSignIn")}
            testId="auth-submit"
            onPress={submit}
            loading={isSubmitting}
          />

          <ClassNameText className="text-sm text-muted">
            {isSignUp ? t("authAlreadySelling") : t("authNewToMarketplace")}
          </ClassNameText>
          <Button
            label={isSignUp ? t("authSignInInstead") : t("authCreateAStore")}
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
export function validate(
  input: {
    mode: AuthMode
    email: string
    password: string
    storeName: string
  },
  locale: Locale = "en",
): string | null {
  const dict = locale === "es" ? es : en
  const fill = (template: string, vars?: Record<string, string | number>) => {
    let out = template
    if (vars) for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{${k}}`, String(v))
    return out
  }
  const email = input.email.trim()
  if (!email) return dict.authEmailRequired
  if (!EMAIL_PATTERN.test(email)) return dict.authEmailInvalid
  if (!input.password) return dict.authPasswordRequired
  if (input.password.length < MIN_PASSWORD_LENGTH) {
    return fill(dict.authPasswordTooShort, { min: MIN_PASSWORD_LENGTH })
  }
  if (input.mode === "sign-up" && !input.storeName.trim()) return dict.authStoreNameRequired
  return null
}

/**
 * Turns whatever the api layer threw into one line.
 *
 * A 401 from `/auth/login` is deliberately vague: the server answers identically
 * for a wrong password and an unknown address, so the client cannot say more
 * than "those credentials did not work" either.
 */
export function messageFor(cause: unknown, locale: Locale = "en"): string {
  if (cause instanceof Error && cause.message) return cause.message
  return locale === "es" ? es.authGenericError : en.authGenericError
}