import { useEffect, useState } from "react"
import { AccessibilityInfo } from "react-native"

// Manual §3: all motion is gated on reduced motion. AccessibilityInfo covers
// both: on web it reads prefers-reduced-motion, on native the OS setting.
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)

  useEffect(() => {
    let mounted = true
    AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (mounted) setReduced(value)
    })
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduced)
    return () => {
      mounted = false
      subscription?.remove()
    }
  }, [])

  return reduced
}
