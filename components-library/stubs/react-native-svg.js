// Web-only stub for Turbopack. react-native-svg's own web build
// (lib/module/ReactNativeSVG.web.js) reaches its DOM-based shapes through an
// extensionless `from './elements'`, relying on a bundler to prefer the
// sibling `elements.web.js` over `elements.js`. Turbopack's `resolveExtensions`
// only applies that preference to project files, not to files inside
// node_modules, so it picks the native `elements.js`, which pulls in
// Fabric-only modules (`TurboModuleRegistry`) that don't exist in
// react-native-web. Importing `elements.web.js` by its explicit,
// unambiguous path sidesteps that resolution entirely.
//
// Only the shape components (Svg, Path, etc.) are re-exported here, since
// that's all this app uses; react-native-svg's XML/CSS helpers pull in
// `xmlTags.js`, which has the same unresolvable `./elements` import and
// would need the same treatment if it's ever needed.
export * from "react-native-svg/lib/module/elements.web.js"
export { default } from "react-native-svg/lib/module/elements.web.js"
