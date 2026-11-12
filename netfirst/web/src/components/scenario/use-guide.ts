"use client"

import "driver.js/dist/driver.css"
import { driver, type Driver, type Side } from "driver.js"
import { useCallback, useEffect, useRef } from "react"

/** Spotlights one element at a time so the user always sees the next action to take. */
export function useGuide(enabled: boolean) {
  const current = useRef<Driver | null>(null)

  const clear = useCallback(() => {
    current.current?.destroy()
    current.current = null
  }, [])

  const show = useCallback(
    (selector: string, title: string, description: string, side: Side = "top") => {
      clear()
      if (!enabled) return
      // Wait for the element to mount and settle after the phase change re-renders.
      window.setTimeout(() => {
        const el = document.querySelector(selector)
        if (!el) return
        el.scrollIntoView({ block: "center", behavior: "smooth" })
        const d = driver({
          popoverClass: "nf-tour nf-guide",
          overlayColor: "#0b1b33",
          overlayOpacity: 0.35,
          stagePadding: 8,
          stageRadius: 14,
          allowClose: true,
          showButtons: ["close"],
        })
        current.current = d
        d.highlight({ element: selector, popover: { title, description, side, align: "center" } })
      }, 350)
    },
    [clear, enabled],
  )

  useEffect(() => clear, [clear])
  useEffect(() => {
    if (!enabled) clear()
  }, [enabled, clear])

  return { show, clear }
}
