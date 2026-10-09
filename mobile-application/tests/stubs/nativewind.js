// Unit-test stub for `nativewind`: the real package's entry executes dev
// checks that pull `react-native-css-interop` into plain Node require(),
// which resolves the real (Flow-typed) `react-native` and crashes the run
// ("Unexpected token 'typeof'"). Components under test only need
// `cssInterop` (identity — same as the setup mock in the other suites) and
// `useColorScheme`; tests that assert on the scheme override this module
// with their own `vi.mock("nativewind")` factory.
export function cssInterop(Component) {
  return Component
}

export function useColorScheme() {
  return { colorScheme: "light", setColorScheme: () => {}, toggleColorScheme: () => {} }
}
