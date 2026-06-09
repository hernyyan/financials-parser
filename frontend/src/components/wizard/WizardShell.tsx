import { useWizardState } from '../../hooks/useWizardState'
import Step1Upload from './Step1Upload'
import Step2Classify from './Step2Classify'
import Step3Finalize from './Step3Finalize'
import TemplateConfigurationWorkflow from './TemplateConfigurationWorkflow'
import { saveTabPreferences } from '../../api/client'

export default function WizardShell() {
  const {
    currentStep,
    editorState,
    setEditorState,
    mergeLayer1Result,
    approveStep1,
    sessionId,
    companyId,
    reportingPeriod,
    sheetAssignments,
    uploadFileType,
  } = useWizardState()

  if (editorState && currentStep === 1) {
    return (
      <TemplateConfigurationWorkflow
        statements={editorState.statements}
        companyId={companyId!}
        sessionId={sessionId!}
        reportingPeriod={reportingPeriod}
        onSaved={(results) => {
          Object.entries(results).forEach(([stmtType, result]) => {
            mergeLayer1Result(stmtType, {
              lineItems: result.lineItems,
              sourceScaling: result.sourceScaling,
              columnIdentified: result.columnIdentified,
              sourceSheet: editorState.statements.find(s => s.statementType === stmtType)?.sheetName ?? '',
              structured: result.structured,
              templateCheck: result.templateCheck,
            })
          })
          // Save tab preferences at this point (template-editor path)
          if (companyId && uploadFileType === 'excel') {
            const toSave: Record<string, string> = {}
            Object.entries(sheetAssignments).forEach(([k, v]) => { if (v) toSave[k] = v })
            if (Object.keys(toSave).length > 0) saveTabPreferences(companyId, toSave).catch(() => {})
          }
          setEditorState(null)
          approveStep1()
        }}
        onCancel={() => setEditorState(null)}
      />
    )
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {currentStep === 1 && <Step1Upload />}
      {currentStep === 2 && <Step2Classify />}
      {currentStep === 3 && <Step3Finalize />}
    </div>
  )
}
