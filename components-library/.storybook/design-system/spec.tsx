/**
 * Shared furniture for the `Design System/*` specimens.
 *
 * These are not components and nothing imports them outside this folder — they
 * are not exported from `src/index.ts`. They exist so every specimen in the
 * section is built from the same parts and reads the same way: the §3 shell, the
 * §2 type roles, and the class string printed under every sample.
 *
 * Two rules from `docs/system-design/index.md` shape this file:
 *
 * - §12: show the class string, do not describe it. Every specimen prints the
 *   exact utility that produced the sample, so a sample cannot quietly drift
 *   away from the rule it documents — the two would visibly disagree instead.
 * - §9: never let colour carry meaning alone. `StatusBadge` pairs its word with a
 *   border weight, and the token swatches print their value as text, so both
 *   survive a reader who cannot separate the tints being demonstrated.
 *
 * Nothing here restates a palette value. `useTokenColor` reads the resolved
 * `--color-*` custom property out of `tokens.css` at runtime, which means a
 * swatch can never claim a value the palette does not actually have.
 */

import type { ComponentType, ReactNode } from "react"
import { useEffect, useState } from "react"
import { Text, View, type TextProps, type ViewProps } from "react-native"
import { cn } from "../../src/utils/cn"

// Cast locally for the reason Button.tsx casts: nativewind's className typing
// does not reach ViewProps/TextProps in this package.
export const ClassNameView = View as ComponentType<ViewProps & { className?: string }>
export const ClassNameText = Text as ComponentType<TextProps & { className?: string }>

/**
 * Resolves `--color-<name>` to a `rgb()` string, through a probe element so the
 * browser normalises the channels rather than the specimen doing it by hand.
 *
 * Re-read on every `.light`/`.dark` change, because that is the only way the
 * palette moves (tokens.css, §1) — a swatch that captured its value once would
 * show the light scheme in dark mode and quietly lie about the token.
 */
/** Resolves one `--color-<name>` custom property to a `rgb()` string. */
function resolveTokenColor(name: string): string {
  if (typeof document === "undefined") return ""
  const probe = document.createElement("div")
  probe.style.backgroundColor = `rgb(var(--color-${name}))`
  document.body.appendChild(probe)
  const resolved = getComputedStyle(probe).backgroundColor
  probe.remove()
  return resolved
}

function useTokenColor(name: string): string {
  const [color, setColor] = useState(() => resolveTokenColor(name))

  useEffect(() => {
    const observer = new MutationObserver(() => setColor(resolveTokenColor(name)))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] })
    return () => observer.disconnect()
  }, [name])

  return color
}

/** The §3 screen shell, so every specimen sits where a real screen would put it. */
export function Sheet({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <ClassNameView className={cn("flex-1 gap-6 bg-background p-6", className)}>
      {children}
    </ClassNameView>
  )
}

/** §2 H1 role. One per story — §9 caps a screen at one. */
export function Heading({ children }: { children: ReactNode }) {
  return (
    <ClassNameText className="text-2xl font-bold leading-8 text-foreground">
      {children}
    </ClassNameText>
  )
}

/** §2 Meta role, held to the §8 prose measure. */
export function Note({ children }: { children: ReactNode }) {
  return (
    <ClassNameText className="max-w-[72ch] text-sm leading-5 text-muted">{children}</ClassNameText>
  )
}

/** §2 Label role: the uppercase overline. Doubles as a specimen's caption. */
export function Overline({ children }: { children: ReactNode }) {
  return (
    <ClassNameText className="text-xs font-semibold uppercase tracking-wide leading-4 text-muted">
      {children}
    </ClassNameText>
  )
}

/** The class string a sample was built from, printed verbatim beneath it (§12). */
export function Sample({ value }: { value: string }) {
  return (
    <ClassNameText className="max-w-[72ch] text-xs leading-4 text-muted">{value}</ClassNameText>
  )
}

/** Side-by-side specimens. Wraps, so a narrow canvas stacks instead of clipping. */
export function Row({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <ClassNameView className={cn("flex-row flex-wrap items-start gap-3", className)}>
      {children}
    </ClassNameView>
  )
}

/** A divider drawn as a border rather than a height, so nothing measures itself. */
export function Rule() {
  return <ClassNameView className="border-t border-surface-muted" />
}

export type SpecStatus = "shipped" | "planned"

/**
 * Whether a rule in the manual is implemented today or is still a decision the
 * team has to agree. "planned" is not a failure state: several §1 and §2 rules
 * are specified and not yet built, and a specimen that rendered them as though
 * they worked would be the worst kind of documentation.
 */
export function StatusBadge({ status }: { status: SpecStatus }) {
  return (
    <ClassNameText
      className={cn(
        "rounded-full px-2 py-1 text-xs font-semibold uppercase tracking-wide leading-4",
        status === "shipped"
          ? "border border-border bg-surface-muted text-muted"
          : "border border-dashed border-border bg-surface text-muted",
      )}
    >
      {status === "shipped" ? "shipped" : "planned"}
    </ClassNameText>
  )
}

/** Caption, status, and the sample — the standard shape of a specimen group. */
export function Spec({
  label,
  status,
  hint,
  className,
  children,
}: {
  label: string
  status: SpecStatus
  hint?: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <ClassNameView className={cn("gap-3", className)}>
      <ClassNameView className="gap-2">
        <ClassNameView className="flex-row flex-wrap items-center gap-2">
          <Overline>{label}</Overline>
          <StatusBadge status={status} />
        </ClassNameView>
        {hint ? <Note>{hint}</Note> : null}
      </ClassNameView>
      {children}
    </ClassNameView>
  )
}

/**
 * A background token drawn at its real value, labelled with the value itself.
 * `token` is the name in `tokens.css`; `className` is the Tailwind name from
 * `tailwind-preset.cjs` — the two are different and both are printed, because
 * §1 is a table of both and a reader has to be able to map one to the other.
 */
export function FillSwatch({
  token,
  className,
  label,
}: {
  token: string
  className: string
  label: string
}) {
  const color = useTokenColor(token)

  return (
    <ClassNameView className="w-44 gap-1">
      <ClassNameView className={cn("h-16 w-full rounded-lg border border-border", className)} />
      <Overline>{label}</Overline>
      <Sample value={`${className} · --color-${token}`} />
      <Sample value={color || "unresolved"} />
    </ClassNameView>
  )
}

/** A text token drawn at its real value on `bg-surface`, per the §1 table. */
export function InkSwatch({
  token,
  className,
  label,
  sample = "Wireless Headphones",
}: {
  token: string
  className: string
  label: string
  sample?: string
}) {
  const color = useTokenColor(token)

  return (
    <ClassNameView className="w-44 gap-1 rounded-lg bg-surface p-3">
      <ClassNameText className={cn("text-base font-semibold leading-6", className)}>
        {sample}
      </ClassNameText>
      <Overline>{label}</Overline>
      <Sample value={`${className} · --color-${token}`} />
      <Sample value={color || "unresolved"} />
    </ClassNameView>
  )
}

/**
 * A token the manual specifies and the palette does not have yet. Drawn as an
 * empty dashed slot rather than a colour, so nothing on screen claims a value
 * `tokens.css` cannot produce.
 */
export function MissingSwatch({
  name,
  intended,
  reason,
}: {
  name: string
  intended: string
  reason: string
}) {
  return (
    <ClassNameView className="w-44 gap-1">
      <ClassNameView className="h-16 w-full rounded-lg border border-dashed border-border bg-surface-muted" />
      <Overline>{name}</Overline>
      <Sample value={`intended: ${intended}`} />
      <Note>{reason}</Note>
    </ClassNameView>
  )
}
