interface PdfViewerProps {
  /** Full URL to the PDF (e.g. http://localhost:8000/files/{session}/{sheet}.pdf) */
  url: string | null
  sheetName?: string
}

export default function PdfViewer({ url, sheetName }: PdfViewerProps) {
  if (!url) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-100 text-gray-400">
        <div className="text-center">
          <div className="text-4xl mb-2">📄</div>
          <p className="text-sm">No file uploaded yet</p>
          <p className="text-xs mt-1">Upload an Excel workbook to view the PDF render</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-gray-200">
      <iframe
        src={url}
        title={sheetName ? `${sheetName} PDF` : 'Sheet PDF'}
        className="flex-1 w-full border-0"
      />
    </div>
  )
}
