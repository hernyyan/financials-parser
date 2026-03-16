import { Document, Page, pdfjs } from 'react-pdf'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'
import { FileText, Loader2 } from 'lucide-react'

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
  if (!pdfUrl) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 text-muted-foreground pt-20">
        <FileText className="w-12 h-12 mb-3 opacity-30" />
        <p className="text-[13px]">Upload a PDF to preview</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Legend bar */}
      <div className="flex items-center gap-3 px-3 py-1.5 border-b border-border text-[11px] text-muted-foreground bg-gray-50 shrink-0">
        <span>{pageCount} pages</span>
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-sm bg-blue-500 inline-block" /> Income Statement
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500 inline-block" /> Balance Sheet
        </span>
      </div>

      {/* Scrollable page thumbnails */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        <Document
          file={pdfUrl}
          loading={
            <div className="flex justify-center pt-10">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
          }
        >
          {Array.from({ length: pageCount }, (_, i) => i + 1).map((pageNum) => {
            const assignment = pageAssignments[pageNum]
            const isIS = assignment === 'income_statement'
            const isBS = assignment === 'balance_sheet'
            const borderClass = isIS
              ? 'border-2 border-blue-500'
              : isBS
                ? 'border-2 border-emerald-500'
                : 'border border-gray-200'

            return (
              <div
                key={pageNum}
                className={`relative rounded-lg overflow-hidden cursor-pointer hover:shadow-md transition-shadow ${borderClass}`}
                onClick={() => onPageClick(pageNum)}
              >
                <Page
                  pageNumber={pageNum}
                  width={280}
                  loading={
                    <div className="flex items-center justify-center h-[180px] bg-gray-50">
                      <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                    </div>
                  }
                />
                {/* Assignment badge */}
                {assignment && (
                  <span
                    className={`absolute top-2 right-2 px-1.5 py-0.5 rounded text-[10px] text-white ${
                      isIS ? 'bg-blue-500' : 'bg-emerald-500'
                    }`}
                    style={{ fontWeight: 600 }}
                  >
                    {isIS ? 'IS' : 'BS'}
                  </span>
                )}
                {/* Page number label */}
                <span className="absolute bottom-1.5 right-2 text-[10px] text-muted-foreground bg-white/80 px-1 rounded">
                  Page {pageNum}
                </span>
              </div>
            )
          })}
        </Document>
      </div>
    </div>
  )
}
