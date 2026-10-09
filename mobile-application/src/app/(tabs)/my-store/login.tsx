import { useCallback } from "react"
import { router } from "expo-router"
import { AuthScreen, useT, type AuthInput } from "@rnw/components-library"
import { login, register } from "../../../api/client"

export default function LoginRoute() {
  const onAuthenticated = useCallback(() => {
    router.replace("/my-store")
  }, [])
  const t = useT()

  return (
    <AuthScreen
      subtitle={t("authSubtitle")}
      onSubmit={(input: AuthInput) =>
        input.storeName === undefined
          ? login({ email: input.email, password: input.password })
          : register({
              email: input.email,
              password: input.password,
              storeName: input.storeName,
            })
      }
      onAuthenticated={onAuthenticated}
    />
  )
}