"use client"

import { useRouter } from "solito/navigation"
import { HomeScreen } from "@rnw/components-library"

export default function Home() {
  const router = useRouter()

  return (
    <HomeScreen
      onOpenStore={() => router.push("/my-store")}
      onSignIn={() => router.push("/login")}
    />
  )
}