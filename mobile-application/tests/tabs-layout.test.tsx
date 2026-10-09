import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { LocaleProvider, SettingsSheet } from "@rnw/components-library"
import TabsLayout from "../src/app/(tabs)/_layout"

const { tabsChildrenSpy, setColorScheme } = vi.hoisted(() => ({
  tabsChildrenSpy: vi.fn(),
  setColorScheme: vi.fn(),
}))

// Regression guard: the settings sheet once lived inside <Tabs> and product
// detail stopped opening. Tabs must carry only the slot + list; the sheet
// (a Modal host) renders alongside the navigator, never inside it.
vi.mock("expo-router/ui", () => ({
  Tabs: ({ children }: { children: ReactNode }) => {
    tabsChildrenSpy(children)
    return <>{children}</>
  },
  TabSlot: () => null,
  TabList: ({ children }: { children: ReactNode }) => <>{children}</>,
  // The real TabTrigger with asChild injects navigation into its MainNav
  // child (the href lives on the trigger, not the item — see _layout.tsx).
  // Emulate that injection so the test renders what production renders.
  TabTrigger: ({ children, href }: { children: ReactNode; href?: string }) =>
    isValidElement(children)
      ? cloneElement(children as ReactElement<{ href?: string }>, { href })
      : children,
}))

vi.mock("nativewind", () => ({
  cssInterop: (Component: unknown) => Component,
  useColorScheme: () => ({ colorScheme: "light", setColorScheme }),
}))

beforeEach(() => {
  tabsChildrenSpy.mockClear()
  setColorScheme.mockClear()
})

function renderLayout(onLocaleChange = vi.fn()) {
  return render(
    <LocaleProvider locale="en" onLocaleChange={onLocaleChange}>
      <TabsLayout />
    </LocaleProvider>,
  )
}

function tabsKids(): ReactNode[] {
  return Children.toArray(tabsChildrenSpy.mock.calls[0][0] as ReactNode)
}

describe("TabsLayout", () => {
  it("keeps the settings sheet outside the Tabs navigator children", () => {
    renderLayout()

    expect(tabsChildrenSpy).toHaveBeenCalledTimes(1)
    expect(tabsKids().some((kid) => isValidElement(kid) && kid.type === SettingsSheet)).toBe(
      false,
    )
  })

  it("keeps the tab triggers navigable", () => {
    renderLayout()

    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/")
    expect(screen.getByRole("button", { name: "Settings" })).toBeInTheDocument()
  })

  it("renders settings first, then the tabs right-aligned in reverse (Home last)", () => {
    const { container } = renderLayout()

    const order = [...container.querySelectorAll("a,button")]
      .map((el) => el.textContent)
      .filter((name) => ["Settings", "Cart", "Wishlist", "My Store", "Home"].includes(name ?? ""))
    expect(order).toEqual(["Settings", "Cart", "Wishlist", "My Store", "Home"])
  })

  it("opens the settings sheet with theme and language options", () => {
    renderLayout()

    fireEvent.click(screen.getByRole("button", { name: "Settings" }))

    expect(screen.getByRole("button", { name: "Light" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Dark" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "English" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Español" })).toBeInTheDocument()
  })

  it("switches theme and language from the sheet", () => {
    const onLocaleChange = vi.fn()
    renderLayout(onLocaleChange)

    fireEvent.click(screen.getByRole("button", { name: "Settings" }))
    fireEvent.click(screen.getByTestId("settings-theme-dark"))
    fireEvent.click(screen.getByTestId("settings-language-es"))

    expect(setColorScheme).toHaveBeenCalledWith("dark")
    expect(onLocaleChange).toHaveBeenCalledWith("es")
  })
})
