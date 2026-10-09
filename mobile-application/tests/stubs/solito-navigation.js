// Unit-test stub for `solito/navigation`'s `useLink`, mirroring the
// react-native-safe-area-context stub: the mobile app never installs solito
// (only components-library's MainNav.web imports it), and the real hook
// needs a mounted Next.js app router. Plain anchor props are all MainNav
// needs to render crawlable links under test.
export function useLink({ href }) {
  return { href, onPress: undefined, accessibilityRole: "link" }
}

export function useRouter() {
  return { push: () => {}, replace: () => {} }
}
