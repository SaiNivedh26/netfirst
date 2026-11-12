"use client"

import React, { useEffect, useRef, useState, type ReactNode } from "react"

interface ParticleHeroProps {
  className?: string
  particleCount?: number
  hue?: number
  children?: ReactNode
}

/** Light-theme particle field that drifts on its own and follows the pointer. */
export const ParticleHero: React.FC<ParticleHeroProps> = ({ className = "", particleCount = 13, hue = 214, children }) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const particlesRef = useRef<HTMLDivElement[]>([])
  const animationFrameRef = useRef<number | null>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [cursor, setCursor] = useState({ x: 0, y: 0 })
  const [staticCursor, setStaticCursor] = useState({ x: 0, y: 0 })
  const [isAutoMode, setIsAutoMode] = useState(true)
  const [isStaticAnimation, setIsStaticAnimation] = useState(false)
  const startTimeRef = useRef(0)
  const lastMouseMoveRef = useRef(0)

  const rows = particleCount
  const totalParticles = rows * rows

  useEffect(() => {
    startTimeRef.current = Date.now()
    if (!containerRef.current) return
    const container = containerRef.current
    container.innerHTML = ""
    particlesRef.current = []
    const center = Math.floor(rows / 2)

    for (let i = 0; i < totalParticles; i++) {
      const particle = document.createElement("div")
      particle.className = "absolute rounded-full will-change-transform"
      const row = Math.floor(i / rows)
      const col = i % rows
      const d = Math.hypot(row - center, col - center)
      const scale = Math.max(0.1, 1.2 - d * 0.12)
      const opacity = Math.max(0.06, 0.9 - d * 0.1)
      const lightness = Math.min(78, 42 + d * 5)
      const glow = Math.max(0.5, 6 - d * 0.5)
      particle.style.cssText = `
        width: 0.4rem; height: 0.4rem;
        left: ${col * 1.8}rem; top: ${row * 1.8}rem;
        transform: scale(${scale}); opacity: ${opacity};
        background: hsl(${hue}, 90%, ${lightness}%);
        box-shadow: 0 0 ${glow * 0.2}rem 0 hsl(${hue}, 90%, 60%);
        z-index: ${Math.round(totalParticles - d * 5)};
      `
      container.appendChild(particle)
      particlesRef.current.push(particle)
    }
  }, [rows, totalParticles, hue])

  useEffect(() => {
    const animate = () => {
      const t = (Date.now() - startTimeRef.current) * 0.001
      if (isAutoMode) {
        setCursor({
          x: Math.sin(t * 0.3) * 200 + Math.sin(t * 0.17) * 100,
          y: Math.cos(t * 0.2) * 150 + Math.cos(t * 0.23) * 80,
        })
      } else if (isStaticAnimation) {
        const idle = Date.now() - lastMouseMoveRef.current
        if (idle > 200) {
          const k = Math.min((idle - 200) / 1000, 1)
          setCursor({ x: staticCursor.x + Math.sin(t * 1.5) * 20 * k, y: staticCursor.y + Math.cos(t * 1.2) * 16 * k })
        }
      }
      animationFrameRef.current = requestAnimationFrame(animate)
    }
    animate()
    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current)
    }
  }, [isAutoMode, isStaticAnimation, staticCursor])

  useEffect(() => {
    const center = Math.floor(rows / 2)
    particlesRef.current.forEach((particle, i) => {
      const d = Math.hypot(Math.floor(i / rows) - center, (i % rows) - center)
      const scale = Math.max(0.1, 1.2 - d * 0.12)
      const damp = Math.max(0.3, 1 - d * 0.08)
      setTimeout(() => {
        particle.style.transform = `translate(${cursor.x * damp}px, ${cursor.y * damp}px) scale(${scale})`
        particle.style.transition = `transform ${120 + d * 20}ms cubic-bezier(0.25, 0.46, 0.45, 0.94)`
      }, d * 8)
    })
  }, [cursor, rows])

  const handlePointerMove = (e: React.MouseEvent | React.TouchEvent) => {
    const p = "touches" in e ? e.touches[0] : e
    const next = { x: (p.clientX - window.innerWidth / 2) * 0.8, y: (p.clientY - window.innerHeight / 2) * 0.8 }
    setCursor(next)
    setStaticCursor(next)
    setIsAutoMode(false)
    setIsStaticAnimation(false)
    lastMouseMoveRef.current = Date.now()
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(() => setIsStaticAnimation(true), 500)
    setTimeout(() => {
      if (Date.now() - lastMouseMoveRef.current >= 4000) {
        setIsAutoMode(true)
        setIsStaticAnimation(false)
        startTimeRef.current = Date.now()
      }
    }, 4000)
  }

  return (
    <section
      className={`relative w-full min-h-screen overflow-hidden bg-white ${className}`}
      onMouseMove={handlePointerMove}
      onTouchMove={handlePointerMove}
    >
      <div aria-hidden="true" className="absolute inset-0 flex items-center justify-center opacity-80">
        <div ref={containerRef} className="relative" style={{ width: `${rows * 1.8}rem`, height: `${rows * 1.8}rem` }} />
      </div>
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_42%_38%_at_center,rgba(255,255,255,0.9)_0%,rgba(255,255,255,0.6)_60%,transparent_100%)]" />
      <div className="relative z-10 flex min-h-screen flex-col items-center justify-center px-6">{children}</div>
    </section>
  )
}
