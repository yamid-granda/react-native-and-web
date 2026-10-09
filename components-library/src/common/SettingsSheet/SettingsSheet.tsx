import type { ComponentType } from "react"
import { Text, View, type TextProps, type ViewProps } from "react-native"
import { Button } from "../Button/Button"
import { Drawer } from "../Drawer/Drawer"
import { useT } from "../../i18n/LocaleContext"
import type { Locale } from "../../i18n/resolveLocale"

// see Button.tsx / README "Architecture boundaries" for why these are cast locally
const ClassNameView = View as ComponentType<ViewProps & { className?: string }>
const ClassNameText = Text as ComponentType<TextProps & { className?: string }>

export type SettingsTheme = "light" | "dark"

export type SettingsSheetProps = {
  visible: boolean
  onClose: () => void
  theme: SettingsTheme
  onThemeChange: (theme: SettingsTheme) => void
  locale: Locale
  onLocaleChange: (locale: Locale) => void
}

// Theme + language picker shown from the nav settings entry point.
// Rendered inside Drawer (shared bottom-sheet Modal) so web and native share
// one tree; selection follows the ProductFilterControls pattern — the current
// option is `primary`, the rest `secondary`, `selected` only announces it.
export function SettingsSheet({
  visible,
  onClose,
  theme,
  onThemeChange,
  locale,
  onLocaleChange,
}: SettingsSheetProps) {
  const t = useT()

  return (
    <Drawer visible={visible} onClose={onClose}>
      <ClassNameText
        accessibilityRole="header"
        className="text-xl font-semibold leading-7 text-foreground"
      >
        {t("settingsTitle")}
      </ClassNameText>
      <ClassNameView className="gap-4">
        <ClassNameView className="gap-2">
          <ClassNameText className="text-xs font-semibold uppercase tracking-wide leading-4 text-muted">
            {t("settingsTheme")}
          </ClassNameText>
          <ClassNameView className="flex-row gap-2">
            <Button
              label={t("settingsThemeLight")}
              testId="settings-theme-light"
              variant={theme === "light" ? "primary" : "secondary"}
              selected={theme === "light"}
              onPress={() => onThemeChange("light")}
              className="flex-1"
            />
            <Button
              label={t("settingsThemeDark")}
              testId="settings-theme-dark"
              variant={theme === "dark" ? "primary" : "secondary"}
              selected={theme === "dark"}
              onPress={() => onThemeChange("dark")}
              className="flex-1"
            />
          </ClassNameView>
        </ClassNameView>
        <ClassNameView className="gap-2">
          <ClassNameText className="text-xs font-semibold uppercase tracking-wide leading-4 text-muted">
            {t("settingsLanguage")}
          </ClassNameText>
          <ClassNameView className="flex-row gap-2">
            <Button
              label={t("settingsEnglish")}
              testId="settings-language-en"
              variant={locale === "en" ? "primary" : "secondary"}
              selected={locale === "en"}
              onPress={() => onLocaleChange("en")}
              className="flex-1"
            />
            <Button
              label={t("settingsSpanish")}
              testId="settings-language-es"
              variant={locale === "es" ? "primary" : "secondary"}
              selected={locale === "es"}
              onPress={() => onLocaleChange("es")}
              className="flex-1"
            />
          </ClassNameView>
        </ClassNameView>
      </ClassNameView>
    </Drawer>
  )
}
