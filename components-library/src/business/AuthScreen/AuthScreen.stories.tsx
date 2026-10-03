import type { Meta, StoryObj } from "@storybook/react"
import { AuthScreen } from "./AuthScreen"
import { useSessionStore } from "./useSessionStore"
import type { AuthSession } from "../../types/Store"

const meta: Meta<typeof AuthScreen> = {
  title: "business/AuthScreen",
  component: AuthScreen,
}

export default meta

type Story = StoryObj<typeof AuthScreen>

/** No real request: the screen owns no api layer, so the story supplies one. */
const pretendSession: AuthSession = {
  token: "storybook-token",
  user: { id: "usr_1", email: "seller@example.com", storeName: "Riverbend Vintage" },
}

export const SignIn: Story = {
  args: {
    subtitle: "Sign in to manage your products.",
    onSubmit: async () => pretendSession,
  },
  play: () => {
    useSessionStore.setState({ token: null, user: null, status: "anonymous" })
  },
}

export const SignUp: Story = {
  args: {
    subtitle: "Open a storefront and start selling.",
    onSubmit: async () => pretendSession,
  },
  play: () => {
    useSessionStore.setState({ token: null, user: null, status: "anonymous" })
  },
}

export const ServerError: Story = {
  args: {
    onSubmit: async () => {
      throw new Error("Invalid email or password")
    },
  },
}