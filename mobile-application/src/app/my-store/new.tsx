import { useCallback, useState } from "react"
import { router } from "expo-router"
import { Text } from "react-native"
import { ProductFormScreen, useRequireSession } from "@rnw/components-library"
import { createMyProduct } from "../../api/client"

export default function NewProductRoute() {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const session = useRequireSession({
    onSignIn: useCallback(() => router.replace("/login"), []),
  })

  if (session.status === "loading") {
    return <Text className="p-6 text-muted">Checking your session…</Text>
  }
  if (session.status === "anonymous") return null

  return (
    <ProductFormScreen
      isSubmitting={isSubmitting}
      error={error}
      onCancel={() => router.back()}
      onSubmit={async (values) => {
        setError(null)
        setIsSubmitting(true)
        try {
          await createMyProduct(values)
          // Back to the list rather than the new product's own screen: the list is
          // what a seller came here to see, and the mutation already invalidated
          // it.
          router.replace("/my-store")
        } catch (cause) {
          setError(cause instanceof Error ? cause : new Error("Could not create the product"))
          setIsSubmitting(false)
        }
      }}
    />
  )
}