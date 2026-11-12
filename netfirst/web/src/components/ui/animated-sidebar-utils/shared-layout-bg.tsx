"use client"

import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { forwardRef, useState, type ElementType, type HTMLAttributes, type MouseEvent } from "react"
import { SPRING_LAYOUT } from "./ease"
import { cn } from "@/lib/utils"

interface SharedLayoutBgProps extends HTMLAttributes<HTMLElement> {
  as?: ElementType
  inset?: number
  pillClassName?: string
  pillContainerClassName?: string
}

/** A hover pill that glides between direct children. */
export const SharedLayoutBg = forwardRef<HTMLElement, SharedLayoutBgProps>(function SharedLayoutBg(
  { as: Tag = "div", inset = 0, pillClassName, pillContainerClassName, className, children, onMouseLeave, onMouseOver, ...props },
  ref,
) {
  const reduce = useReducedMotion()
  const [box, setBox] = useState<{ top: number; height: number } | null>(null)

  const track = (event: MouseEvent<HTMLElement>) => {
    onMouseOver?.(event)
    const root = event.currentTarget
    let node = event.target as HTMLElement | null
    while (node && node.parentElement !== root) node = node.parentElement
    if (!node || node.dataset.slot === "shared-pill") return
    const button = node.querySelector<HTMLElement>("a,button") ?? node
    setBox({ top: node.offsetTop + button.offsetTop + inset, height: button.offsetHeight - inset * 2 })
  }

  return (
    <Tag
      {...props}
      ref={ref}
      onMouseOver={track}
      onMouseLeave={(event: MouseEvent<HTMLElement>) => {
        onMouseLeave?.(event)
        setBox(null)
      }}
      className={cn("relative", className)}
    >
      <AnimatePresence>
        {box ? (
          <motion.span
            key="pill"
            data-slot="shared-pill"
            aria-hidden="true"
            initial={{ opacity: 0, y: box.top, height: box.height }}
            animate={{ opacity: 1, y: box.top, height: box.height }}
            exit={{ opacity: 0 }}
            transition={reduce ? { duration: 0 } : SPRING_LAYOUT}
            className={cn("pointer-events-none absolute inset-x-0 block", pillContainerClassName, pillClassName)}
            style={{ top: 0 }}
          />
        ) : null}
      </AnimatePresence>
      {children}
    </Tag>
  )
})
