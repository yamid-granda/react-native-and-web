"use client"

import { useRouter } from "solito/navigation"
import { AuthScreen, useT, type AuthInput } from "@rnw/components-library"
import { login, register } from "../../lib/api"

export default function LoginPage() {
  const router = useRouter()
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
      onAuthenticated={() => router.replace("/my-store")}
    />
  )
}