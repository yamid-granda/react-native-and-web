"use client"

import { useRouter } from "solito/navigation"
import { AuthScreen, type AuthInput } from "@rnw/components-library"
import { login, register } from "../../lib/api"

export default function LoginPage() {
  const router = useRouter()

  return (
    <AuthScreen
      subtitle="Sign in to manage your products, or open a storefront of your own."
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