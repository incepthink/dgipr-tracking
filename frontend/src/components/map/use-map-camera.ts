import { useCallback, useEffect, useRef, useState } from 'react'

const MIN_SCALE = 1
const MAX_SCALE = 16
const WHEEL_SENSITIVITY = 0.0022
/** Pointer travel, in on-screen pixels, before a press becomes a drag. */
const DRAG_SLOP = 3
/** How long a button zoom or a reset takes to settle. */
const GLIDE_MS = 320

interface Point { x: number; y: number }

type Gesture =
  /** `from` is where the pointer was on the *previous* frame, not where the
   *  press started — see `onPointerMove`. `origin` is the press, in client
   *  pixels, and is only ever read by the drag threshold. */
  | { kind: 'pan'; from: Point; origin: Point }
  | { kind: 'pinch'; span: number; midpoint: Point }
  | null

/**
 * Pan, zoom and pinch for an SVG whose viewBox is `0 0 width height`.
 *
 * The camera pivots on the view-box centre M, so a content point p lands at
 * `M + scale * (p - M) + offset`. Every function below is that one line solved
 * for a different unknown, and the SVG transform written in `apply` is the
 * same line spelled out as translate, scale, translate.
 *
 * Nothing here is React state. A pan fires a pointermove per frame, and
 * re-rendering thirty-six paths to move a transform sixty times a second is
 * the difference between a map that glides and one that stutters — so the
 * camera writes the attribute on the group itself, and React is told only
 * about `isPanning`, which changes twice per gesture.
 */
export function useMapCamera([width, height]: [number, number]) {
  const svgRef = useRef<SVGSVGElement | null>(null)
  const groupRef = useRef<SVGGElement | null>(null)
  const view = useRef({ x: 0, y: 0, scale: 1 })
  const [isPanning, setIsPanning] = useState(false)
  const pointers = useRef(new Map<number, Point>())
  const gesture = useRef<Gesture>(null)
  /** Stays true until the next press, so a drag never lands as a click. */
  const dragged = useRef(false)
  const glide = useRef<number | null>(null)

  const midX = width / 2
  const midY = height / 2

  const apply = useCallback(() => {
    const { x, y, scale } = view.current
    groupRef.current?.setAttribute(
      'transform',
      `translate(${midX + x} ${midY + y}) scale(${scale}) translate(${-midX} ${-midY})`,
    )
  }, [midX, midY])

  const settle = useCallback(
    (scale: number, x: number, y: number) => {
      const clamped = clamp(scale, MIN_SCALE, MAX_SCALE)
      view.current = {
        scale: clamped,
        x: clampOffset(x, clamped, width),
        y: clampOffset(y, clamped, height),
      }
      apply()
    },
    [apply, height, width],
  )

  /** The same move, eased, for the gestures that are a command rather than a
   *  drag: the two buttons, the reset and a double-click. */
  const glideTo = useCallback(
    (scale: number, x: number, y: number) => {
      if (glide.current !== null) cancelAnimationFrame(glide.current)

      const target = clamp(scale, MIN_SCALE, MAX_SCALE)
      const from = { ...view.current }
      const to = {
        scale: target,
        x: clampOffset(x, target, width),
        y: clampOffset(y, target, height),
      }
      const start = performance.now()

      const step = (now: number) => {
        const t = Math.min(1, (now - start) / GLIDE_MS)
        // Ease-out cubic: fast off the mark, no overshoot. A spring would
        // overshoot the zoom clamp and bounce off it.
        const e = 1 - (1 - t) ** 3

        settle(
          from.scale + (to.scale - from.scale) * e,
          from.x + (to.x - from.x) * e,
          from.y + (to.y - from.y) * e,
        )

        glide.current = t < 1 ? requestAnimationFrame(step) : null
      }

      glide.current = requestAnimationFrame(step)
    },
    [height, settle, width],
  )

  useEffect(() => {
    apply()
    return () => {
      if (glide.current !== null) cancelAnimationFrame(glide.current)
    }
  }, [apply])

  /**
   * Rescale so that whatever content sits under `from` ends up under `to`.
   * Zoom, pinch and drag are all this call with different arguments.
   */
  const reframe = useCallback(
    (scale: number, from: Point, to: Point, eased: boolean) => {
      const current = view.current.scale
      const next = clamp(scale, MIN_SCALE, MAX_SCALE)
      const heldX = midX + (from.x - midX - view.current.x) / current
      const heldY = midY + (from.y - midY - view.current.y) / current

      const move = eased ? glideTo : settle
      move(next, to.x - midX - next * (heldX - midX), to.y - midY - next * (heldY - midY))
    },
    [glideTo, midX, midY, settle],
  )

  const zoomAt = useCallback(
    (factor: number, anchor: Point, eased = false) =>
      reframe(view.current.scale * factor, anchor, anchor, eased),
    [reframe],
  )

  const zoomBy = useCallback(
    (factor: number) => zoomAt(factor, { x: midX, y: midY }, true),
    [midX, midY, zoomAt],
  )

  const reset = useCallback(() => glideTo(1, 0, 0), [glideTo])

  // React marks `wheel` passive on its root listener, so the zoom gesture has
  // to bind natively to keep the page from scrolling underneath it.
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return

    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const anchor = toContentSpace(svg, event)
      if (anchor) zoomAt(Math.exp(-event.deltaY * WHEEL_SENSITIVITY), anchor)
    }

    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
  }, [zoomAt])

  const onPointerDown = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return

    const point = toContentSpace(event.currentTarget, event)
    if (!point) return

    pointers.current.set(event.pointerId, point)
    const active = [...pointers.current.values()]

    if (active.length === 1) {
      dragged.current = false
      gesture.current = {
        kind: 'pan',
        from: point,
        origin: { x: event.clientX, y: event.clientY },
      }
      // Capture is deliberately deferred to the first real drag below: taking
      // it on press retargets the follow-up click to the <svg>, which would
      // stop any district from ever registering one.
      return
    }

    if (active.length === 2) {
      // A second finger is never a tap, so lock out selection straight away.
      dragged.current = true
      setIsPanning(true)
      gesture.current = {
        kind: 'pinch',
        span: distance(active[0], active[1]),
        midpoint: middle(active[0], active[1]),
      }
    }
  }, [])

  const onPointerMove = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      if (!pointers.current.has(event.pointerId)) return

      const point = toContentSpace(event.currentTarget, event)
      if (!point) return

      pointers.current.set(event.pointerId, point)
      const active = [...pointers.current.values()]
      const current = gesture.current

      if (current?.kind === 'pinch' && active.length >= 2) {
        const span = distance(active[0], active[1])
        const midpoint = middle(active[0], active[1])
        if (span <= 1e-6 || current.span <= 1e-6) return

        reframe(view.current.scale * (span / current.span), current.midpoint, midpoint, false)
        gesture.current = { kind: 'pinch', span, midpoint }
        return
      }

      if (current?.kind !== 'pan') return

      // The threshold is measured in client pixels, not view-box units: the
      // camera lives on an inner group, so it is not in the SVG's screen
      // matrix, and that matrix already folds in the view-box fit.
      if (!dragged.current) {
        const travel = Math.hypot(
          event.clientX - current.origin.x,
          event.clientY - current.origin.y,
        )
        if (travel < DRAG_SLOP) return

        dragged.current = true
        event.currentTarget.setPointerCapture(event.pointerId)
        setIsPanning(true)
      }

      // Against the previous frame, never against the press: leaving `from` at
      // the press point re-applies the whole travel every frame, and the map
      // accelerates away from the pointer at roughly the frame rate.
      settle(
        view.current.scale,
        view.current.x + point.x - current.from.x,
        view.current.y + point.y - current.from.y,
      )

      gesture.current = { kind: 'pan', from: point, origin: current.origin }
    },
    [reframe, settle],
  )

  const endPan = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    if (!pointers.current.delete(event.pointerId)) return

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }

    const active = [...pointers.current.values()]

    // Lifting one finger of a pinch hands the drag back to the one still down.
    // It is already past the threshold, so `origin` only has to be somewhere.
    gesture.current =
      active.length === 1 ? { kind: 'pan', from: active[0], origin: active[0] } : null

    if (active.length === 0) setIsPanning(false)
  }, [])

  return {
    svgRef,
    groupRef,
    isPanning,
    hasDragged: () => dragged.current,
    zoomBy,
    reset,
    surfaceProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endPan,
      onPointerCancel: endPan,
      onDoubleClick: (event: React.MouseEvent<SVGSVGElement>) => {
        const anchor = toContentSpace(event.currentTarget as SVGSVGElement, event)
        if (anchor) zoomAt(1.8, anchor, true)
      },
    },
  }
}

/** Client pixels to the SVG's own user-space units. */
function toContentSpace(
  svg: SVGSVGElement,
  event: { clientX: number; clientY: number },
): Point | null {
  const matrix = svg.getScreenCTM()
  if (!matrix) return null

  const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse())
  return { x: point.x, y: point.y }
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function middle(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

/**
 * Keep the artwork covering the viewport. Pivoting around the centre makes the
 * usable offset range symmetric.
 */
function clampOffset(value: number, scale: number, extent: number): number {
  const limit = ((scale - 1) * extent) / 2
  return Math.min(limit, Math.max(-limit, value))
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
