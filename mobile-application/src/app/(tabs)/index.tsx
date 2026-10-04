import { router } from "expo-router"
import { HomeScreen } from "@rnw/components-library"

export default function HomeRoute() {
  return (
    <HomeScreen
      onOpenStore={() => router.push("/my-store")}
      onSignIn={() => router.push("/login")}
    />
  )
}