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
 * The rendering half of `useRequireSession`.
 *
 * `useRequireSession` stops one step short on purpose — it hands back a
 * discriminated result so the caller decides what "loading" and "signed out" look
 * like. Every authenticated route then made the same decision in the same words,
 * which is why "Checking your session…" was written out once per screen per
 * platform. This is that decision, made once.
 *
 * Children must be a *component*, not more hooks in the caller's own body: a
 * child that is not rendered runs none of its hooks, which is what lets a
 * screen put its authenticated-only query behind the gate without an `enabled`
 * flag of its own.
 */
export function SessionGate({ onSignIn, children }: SessionGateProps) {
  const session = useRequireSession({ onSignIn })

  if (session.status === "loading") {
    return <ClassNameText className="p-6 text-muted">Checking your session…</ClassNameText>
  }

  // `children` is returned as-is rather than wrapped in a fragment: this component
  // has nothing to add around them, and the single-child fragment exists only to
  // hold a value React would not otherwise take as a return.
  return session.status === "anonymous" ? null : children
}
