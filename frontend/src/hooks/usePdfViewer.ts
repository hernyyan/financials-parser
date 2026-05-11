/**
 * usePdfViewer — owns all scroll, zoom, and viewport tracking state for PdfPageViewer.
 *
 * Hides:
 *   - ResizeObserver tracking the main view container width
 *   - IntersectionObserver tracking the most-visible page (currentPage)
 *   - Thumbnail auto-scroll when currentPage changes
 *   - zoom state + zoomIn/zoomOut handlers
 *   - All four refs (mainViewRef, pageRefs, thumbnailRefs, currentPageRef)
 *   - scrollMainToPage imperative scroll helper
 *
 * Caller only needs to pass `pageCount` and attach the returned refs + handlers.
 */
import { useEffect, useRef, useState } from 'react'

interface UsePdfViewerOptions {
  pageCount: number
}

export function usePdfViewer({ pageCount }: UsePdfViewerOptions) {
  const [zoom, setZoom] = useState(0.8)
  const [currentPage, setCurrentPage] = useState(1)
  const [mainViewWidth, setMainViewWidth] = useState(600)

  const mainViewRef = useRef<HTMLDivElement>(null)
  const pageRefs = useRef<Record<number, HTMLDivElement | null>>({})
  const thumbnailRefs = useRef<Record<number, HTMLDivElement | null>>({})
  const currentPageRef = useRef(1)

  function zoomIn() { setZoom((z) => Math.min(+(z + 0.1).toFixed(1), 2.0)) }
  function zoomOut() { setZoom((z) => Math.max(+(z - 0.1).toFixed(1), 0.5)) }

  // Track main view container width via ResizeObserver
  useEffect(() => {
    const el = mainViewRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setMainViewWidth(entry.contentRect.width - 40)
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Set up IntersectionObserver once after pages render, never reconnect on page change
  useEffect(() => {
    const root = mainViewRef.current
    if (!root || pageCount === 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        let maxRatio = 0
        let mostVisible = currentPageRef.current
        for (const entry of entries) {
          if (entry.intersectionRatio > maxRatio) {
            maxRatio = entry.intersectionRatio
            const num = parseInt((entry.target as HTMLElement).dataset.page ?? '1')
            mostVisible = num
          }
        }
        if (maxRatio > 0 && mostVisible !== currentPageRef.current) {
          currentPageRef.current = mostVisible
          setCurrentPage(mostVisible)
        }
      },
      { root, threshold: [0, 0.1, 0.25, 0.5, 0.75, 1.0] },
    )

    // Small delay to let react-pdf render page elements into the DOM
    const timer = setTimeout(() => {
      for (const el of Object.values(pageRefs.current)) {
        if (el) observer.observe(el)
      }
    }, 300)

    return () => {
      clearTimeout(timer)
      observer.disconnect()
    }
  }, [pageCount])

  // Scroll thumbnail into view when currentPage changes
  useEffect(() => {
    thumbnailRefs.current[currentPage]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [currentPage])

  function scrollMainToPage(pageNum: number) {
    pageRefs.current[pageNum]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return {
    zoom,
    zoomIn,
    zoomOut,
    currentPage,
    mainViewWidth,
    mainViewRef,
    pageRefs,
    thumbnailRefs,
    scrollMainToPage,
  }
}
