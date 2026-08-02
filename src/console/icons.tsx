/**
 * Console glyphs. Drawn as inline SVG strokes so they inherit `currentColor`
 * and stay crisp at 10–12px. No icon font, no emoji (DESIGN.md anti-slop).
 */

import type { ReactNode } from 'react'

interface GlyphProps {
  size?: number
  className?: string
}

function Svg({ size = 12, className, children }: GlyphProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {children}
    </svg>
  )
}

export function ChevronUp(props: GlyphProps) {
  return (
    <Svg {...props}>
      <path d="M2.5 7.5 6 4l3.5 3.5" />
    </Svg>
  )
}

export function ChevronDown(props: GlyphProps) {
  return (
    <Svg {...props}>
      <path d="M2.5 4.5 6 8l3.5-3.5" />
    </Svg>
  )
}

export function ChevronRight(props: GlyphProps) {
  return (
    <Svg {...props}>
      <path d="M4.5 2.5 8 6l-3.5 3.5" />
    </Svg>
  )
}

export function ChevronLeft(props: GlyphProps) {
  return (
    <Svg {...props}>
      <path d="M7.5 2.5 4 6l3.5 3.5" />
    </Svg>
  )
}

export function Cross(props: GlyphProps) {
  return (
    <Svg {...props}>
      <path d="M3 3l6 6M9 3l-6 6" />
    </Svg>
  )
}
