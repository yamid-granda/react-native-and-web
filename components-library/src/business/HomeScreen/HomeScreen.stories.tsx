import type { Meta, StoryObj } from "@storybook/react"
import { HomeScreen } from "./HomeScreen"
import { useSessionStore } from "../AuthScreen/useSessionStore"

const meta: Meta<typeof HomeScreen> = {
  title: "business/HomeScreen",
  component: HomeScreen,
}

export default meta

type Story = StoryObj<typeof HomeScreen>

export const Default: Story = {
  play: () => {
    useSessionStore.setState({ token: null, user: null, status: "anonymous" })
  },
}

export const SignedIn: Story = {
  args: {
    onOpenStore: () => {},
    onSignIn: () => {},
  },
  play: () => {
    useSessionStore.getState().setSession({
      token: "storybook-token",
      user: { id: "usr_1", email: "seller@example.com", storeName: "Riverbend Vintage" },
    })
  },
}