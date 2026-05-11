/**
 * useFileUpload — owns the file upload lifecycle for Step1Upload.
 *
 * Manages: uploading/isDragOver state, POST /upload call, wizard state
 * updates on success (sheet names, pdf pages, workbook url, session id),
 * drag-and-drop validation, reupload/clear reset logic.
 *
 * Returns handlers ready to attach to DOM events and toolbar buttons.
 */
import { useState } from 'react'
import { uploadFile } from '../api/client'
import type { Layer1Result, StatusMessage, StatementType } from '../types'
import { getErrorMessage } from '../utils/errorUtils'

interface UseFileUploadDeps {
  companyName: string
  companyId: number | null
  reportingPeriod: string
  fileInputRef: React.RefObject<HTMLInputElement>
  // wizard state setters
  setUploadedFile: (file: File | null) => void
  setSessionId: (id: string | null) => void
  setUploadFileType: (type: 'excel' | 'pdf' | null) => void
  setLayer1Results: (r: Record<string, Layer1Result>) => void
  setSheetNames: (names: string[]) => void
  setWorkbookUrl: (url: string | null) => void
  setPdfPageCount: (n: number) => void
  setPdfUrl: (url: string | null) => void
  setPdfPageAssignments: (a: Record<number, StatementType>) => void
  // extraction hook resets
  resetExcelExtraction: () => void
  resetPdfExtraction: () => void
  // status / context
  setStatus: (s: StatusMessage) => void
  onContextFetch: (companyId: number) => void
  onClearContext: () => void
}

export function useFileUpload({
  companyName,
  companyId,
  reportingPeriod,
  fileInputRef,
  setUploadedFile,
  setSessionId,
  setUploadFileType,
  setLayer1Results,
  setSheetNames,
  setWorkbookUrl,
  setPdfPageCount,
  setPdfUrl,
  setPdfPageAssignments,
  resetExcelExtraction,
  resetPdfExtraction,
  setStatus,
  onContextFetch,
  onClearContext,
}: UseFileUploadDeps) {
  const [uploading, setUploading] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)

  async function handleFileUpload(file: File) {
    const isPdf = file.name.toLowerCase().endsWith('.pdf')
    setUploading(true)
    setStatus(null)
    try {
      const response = await uploadFile(file, companyName, reportingPeriod)
      setUploadedFile(file)
      setSessionId(response.sessionId)
      setUploadFileType(response.fileType)
      setLayer1Results({})

      if (response.fileType === 'pdf') {
        setPdfPageCount(response.pdfPageCount ?? 0)
        setPdfUrl(response.pdfUrl ?? null)
        setSheetNames([])
        setWorkbookUrl(null)
        setPdfPageAssignments({})
      } else {
        setSheetNames(response.sheetNames)
        setWorkbookUrl(response.workbookUrl)
        setPdfPageCount(0)
        setPdfUrl(null)
        setPdfPageAssignments({})
        resetExcelExtraction()
      }

      setStatus({
        type: 'success',
        message: isPdf
          ? `Uploaded "${file.name}" — ${response.pdfPageCount} page(s) found. Select pages for each statement.`
          : `Uploaded "${file.name}" — ${response.sheetNames.length} sheet(s) found.`,
      })

      if (companyId) {
        onContextFetch(companyId)
      }
    } catch (err) {
      setStatus({
        type: 'error',
        message: getErrorMessage(err, 'Upload failed. Check that the backend is running.'),
      })
    } finally {
      setUploading(false)
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    void handleFileUpload(file)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(true)
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOver(false)
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (!file) return
    const name = file.name.toLowerCase()
    if (!name.endsWith('.xlsx') && !name.endsWith('.xls') && !name.endsWith('.pdf')) {
      setStatus({ type: 'error', message: 'Only Excel (.xlsx, .xls) and PDF files are supported.' })
      return
    }
    void handleFileUpload(file)
  }

  function clearUploadState() {
    setUploadedFile(null)
    setSessionId(null)
    setSheetNames([])
    setWorkbookUrl(null)
    setLayer1Results({})
    resetExcelExtraction()
    resetPdfExtraction()
    setStatus(null)
    onClearContext()
    setUploadFileType(null)
    setPdfPageCount(0)
    setPdfUrl(null)
    setPdfPageAssignments({})
  }

  function handleReupload() {
    clearUploadState()
    setTimeout(() => fileInputRef.current?.click(), 0)
  }

  function handleClearUpload() {
    clearUploadState()
  }

  return {
    uploading,
    isDragOver,
    handleFileChange,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleReupload,
    handleClearUpload,
  }
}
