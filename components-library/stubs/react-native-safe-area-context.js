// Storybook-only stub. nativewind's cssInterop unconditionally registers a
// SafeAreaView wrapper by `require("react-native-safe-area-context")`, but
// that package's web-facing build still statically imports a native-only
// codegen spec (`react-native/Libraries/Utilities/codegenNativeComponent`)
// that react-native-web has no equivalent for, breaking esbuild's dep
// optimizer. None of these stories render SafeAreaProvider/SafeAreaView, so
// a plain View standing in for it is enough to satisfy the registration.
import { View } from "react-native-web"

export const SafeAreaProvider = View
export const SafeAreaView = View
export const useSafeAreaInsets = () => ({ top: 0, right: 0, bottom: 0, left: 0 })
