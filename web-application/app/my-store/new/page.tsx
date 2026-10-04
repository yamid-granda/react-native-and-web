"use client"

import { useCallback, useState } from "react"
import { useRouter } from "solito/navigation"
import { ProductFormScreen, SessionGate } from "@rnw/components-library"
import { createMyProduct } from "../../../lib/api"

export default function NewProductPage() {
  const router = useRouter()
  const signIn = useCallback(() => router.replace("/login"), [router])

  return (
    <SessionGate onSignIn={signIn}>
      <NewProductForm />
    </SessionGate>
  )
}

/**
 * Split out of the route so the submit state belongs to a component that only
 * exists once there is a session; `SessionGate` renders nothing before then.
 */
function NewProductForm() {
  const router = useRouter()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<Error | null>(null)

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
          // Back to the list rather than the new product's page: the list is what
          // a seller came here to see, and it is already invalidated by the
          // mutation.
          router.replace("/my-store")
        } catch (cause) {
          setError(cause instanceof Error ? cause : new Error("Could not create the product"))
          setIsSubmitting(false)
        }
      }}
    />
  )
}
