import type { ComponentType, ReactNode } from "react"
import { Text, type TextProps } from "react-native"
import { useRequireSession } from "./useRequireSession"

// see Button.tsx / README "Architecture boundaries" for why these are cast locally
const ClassNameText = Text as ComponentType<TextProps & { className?: string }>

export type SessionGateProps = {
  /** Called when there is no session. Route to the login screen from here. */
  onSignIn: () => void
  children: ReactNode
}

/**
 * `useRequireSession` rendered: the guard in front of every authenticated screen.
 *
 * `useRequireSession` returns a result instead of rendering so that `AuthScreen`
 * can branch on it, but every *route* wants the same three outcomes — loading
 * text, nothing when anonymous, children when signed in. Six copies of those six
 * lines is six places for the loading string to drift, and it had.
 *
 * The session status is not handed to children: the guard is meant to be the
 * outermost thing in a route file, with the child a sibling component rather than
 * more hooks in the same function body, so a child that needs the status can call
 * `useRequireSession` for itself.
 */
export function SessionGate({ onSignIn, children }: SessionGateProps) {
  const session = useRequireSession({ onSignIn })

  if (session.status === "loading") {
    return <ClassNameText className="p-6 text-muted">Checking your session…</ClassNameText>
  }
  return session.status === "anonymous" ? null : children
}