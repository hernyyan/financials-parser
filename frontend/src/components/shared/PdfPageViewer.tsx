import { useEffect, useRef, useState, useCallback } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'
import { FileText, Loader2, Minus, Plus } from 'lucide-react'

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

interface PdfPageViewerProps {
  pdfUrl: string | null
  pageCount: number
  pageAssignments: Record<number, 'income_statement' | 'balance_sheet'>
  activeStatementTab: 'income_statement' | 'balance_sheet'
  onPageClick: (pageNumber: number) => void
}

export default function PdfPageViewer({
  pdfUrl,
  pageCount,
  pageAssignments,
  activeStatementTab,
  onPageClick,
}: PdfPageViewerProps) {
  const [zoom, setZoom] = useState(0.8)
  const [currentPage, setCurrentPage] = useState(1)
  const [mainViewWidth, setMainViewWidth] = useState(600)

  const mainViewRef = useRef<HTMLDivElement>(null)
  const pageRefs = useRef<Record<number, HTMLDivElement | null>>({})
  const thumbnailRefs = useRef<Record<number, HTMLDivElement | null>>({})
  const observerRef = useRef<IntersectionObserver | null>(null)

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

  // IntersectionObserver: track which page is most visible in the main view
  const setupObserver = useCallback(() => {
    if (observerRef.current) observerRef.current.disconnect()
    const root = mainViewRef.current
    if (!root) return

    observerRef.current = new IntersectionObserver(
      (entries) => {
        let maxRatio = 0
        let mostVisible = currentPage
        for (const entry of entries) {
          if (entry.intersectionRatio > maxRatio) {
            maxRatio = entry.intersectionRatio
            const num = parseInt((entry.target as HTMLElement).dataset.page ?? '1')
            mostVisible = num
          }
        }
        if (maxRatio > 0) setCurrentPage(mostVisible)
      },
      { root, threshold: [0, 0.25, 0.5, 0.75, 1.0] },
    )

    for (const el of Object.values(pageRefs.current)) {
      if (el) observerRef.current.observe(el)
    }
  }, [currentPage])

  useEffect(() => {
    setupObserver()
    return () => observerRef.current?.disconnect()
  }, [pageCount, setupObserver])

  // Scroll thumbnail sidebar to keep active thumbnail in view
  useEffect(() => {
    thumbnailRefs.current[currentPage]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [currentPage])

  function scrollMainToPage(pageNum: number) {
    pageRefs.current[pageNum]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  if (!pdfUrl) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 text-muted-foreground pt-20">
        <FileText className="w-12 h-12 mb-3 opacity-30" />
        <p className="text-[13px]">Upload a PDF to preview</p>
      </div>
    )
  }

  const pages = Array.from({ length: pageCount }, (_, i) => i + 1)

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Top info bar */}
      <div className="flex items-center gap-3 px-3 py-1.5 border-b border-border text-[11px] text-muted-foreground bg-gray-50 shrink-0">
        <span>{pageCount} pages</span>
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-sm bg-blue-500 inline-block" /> Income Statement
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500 inline-block" /> Balance Sheet
        </span>
      </div>

      {/* Main area: thumbnail sidebar + main view */}
      <div className="flex flex-1 min-h-0">
        {/* Thumbnail sidebar */}
        <div className="w-[120px] border-r border-border overflow-y-auto bg-gray-50/50 py-2 px-2 flex flex-col gap-2 shrink-0">
          <Document
            file={pdfUrl}
            loading={
              <div className="flex justify-center pt-6">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            }
          >
            {pages.map((pageNum) => {
              const assignment = pageAssignments[pageNum]
              const isActive = currentPage === pageNum
              const borderClass = assignment === 'income_statement'
                ? 'border-blue-500'
                : assignment === 'balance_sheet'
                  ? 'border-emerald-500'
                  : isActive
                    ? 'border-gray-400'
                    : 'border-gray-200'

              return (
                <div
                  key={pageNum}
                  ref={(el) => { thumbnailRefs.current[pageNum] = el }}
                  className="flex flex-col items-center cursor-pointer"
                  onClick={() => { onPageClick(pageNum); scrollMainToPage(pageNum) }}
                >
                  <div
                    className={`relative rounded border-2 overflow-hidden transition-all hover:shadow-sm ${borderClass} ${
                      isActive ? 'ring-2 ring-offset-1 ring-gray-300' : ''
                    }`}
                  >
                    <Page
                      pageNumber={pageNum}
                      width={96}
                      renderTextLayer={false}
                      renderAnnotationLayer={false}
                    />
                    {assignment && (
                      <span
                        className={`absolute top-1 right-1 px-1 py-0.5 rounded text-[9px] text-white ${
                          assignment === 'income_statement' ? 'bg-blue-500' : 'bg-emerald-500'
                        }`}
                        style={{ fontWeight: 600 }}
                      >
                        {assignment === 'income_statement' ? 'IS' : 'BS'}
                      </span>
                    )}
                  </div>
                  <span
                    className={`text-[10px] mt-0.5 ${isActive ? 'text-foreground' : 'text-muted-foreground'}`}
                    style={{ fontWeight: isActive ? 500 : 400 }}
                  >
                    {pageNum}
                  </span>
                </div>
              )
            })}
          </Document>
        </div>

        {/* Main page view — continuous scroll */}
        <div
          ref={mainViewRef}
          className="flex-1 overflow-auto bg-gray-100 flex flex-col items-center py-4 gap-4"
        >
          <Document
            file={pdfUrl}
            loading={
              <div className="flex items-center justify-center py-20">
                <Loader2 className="w-8 h-8 animate-spin" style={{ color: '#030213' }} />
              </div>
            }
          >
            {pages.map((pageNum) => {
              const assignment = pageAssignments[pageNum]
              return (
                <div
                  key={pageNum}
                  data-page={pageNum}
                  ref={(el) => { pageRefs.current[pageNum] = el }}
                  className={`relative cursor-pointer shadow-md bg-white ${
                    assignment === 'income_statement'
                      ? 'ring-2 ring-blue-400'
                      : assignment === 'balance_sheet'
                        ? 'ring-2 ring-emerald-400'
                        : ''
                  }`}
                  onClick={() => onPageClick(pageNum)}
                >
                  <Page
                    pageNumber={pageNum}
                    width={mainViewWidth * zoom}
                    renderTextLayer={true}
                    renderAnnotationLayer={false}
                  />
                  {/* Page number + badge overlay */}
                  <div className="absolute bottom-2 right-2 flex items-center gap-1.5">
                    {assignment && (
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] text-white ${
                          assignment === 'income_statement' ? 'bg-blue-500' : 'bg-emerald-500'
                        }`}
                        style={{ fontWeight: 600 }}
                      >
                        {assignment === 'income_statement' ? 'IS' : 'BS'}
                      </span>
                    )}
                    <span className="px-1.5 py-0.5 rounded bg-black/50 text-white text-[10px]">
                      Page {pageNum}
                    </span>
                  </div>
                </div>
              )
            })}
          </Document>
        </div>
      </div>

      {/* Bottom bar */}
      <div className="flex items-center justify-between px-3 py-1 border-t border-border bg-gray-50 text-[11px] text-muted-foreground shrink-0">
        <div className="flex items-center gap-2">
          <button onClick={zoomOut} className="p-0.5 rounded hover:bg-gray-200">
            <Minus className="w-3.5 h-3.5" />
          </button>
          <span style={{ fontWeight: 500 }} className="text-foreground min-w-[36px] text-center">
            {Math.round(zoom * 100)}%
          </span>
          <button onClick={zoomIn} className="p-0.5 rounded hover:bg-gray-200">
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
        <span>Page {currentPage} of {pageCount}</span>
      </div>
    </div>
  )
}
