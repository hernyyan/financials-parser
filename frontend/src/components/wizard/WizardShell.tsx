import { useWizardState } from '../../hooks/useWizardState'
import Step1Upload from './Step1Upload'
import Step2Classify from './Step2Classify'
import Step3Finalize from './Step3Finalize'
import TemplateEditor from './TemplateEditor'
import LayoutReconciliation from './LayoutReconciliation'

export default function WizardShell() {
  const { currentStep, editorState, setEditorState, mergeLayer1Result, approveStep1, sessionId, companyId, reportingPeriod } = useWizardState()

  // Template editor overlays (full-screen, rendered above step content)
  if (editorState && currentStep === 1) {
    if (editorState.mode === 'new' || (editorState.mode === 'reconcile' && !editorState.diff)) {
      return (
        <TemplateEditor
          stepCRows={editorState.stepCRows}
          existingTemplate={editorState.existingTemplate}
          statementType={editorState.statementType}
          companyId={companyId!}
          sessionId={sessionId!}
          reportingPeriod={reportingPeriod}
          sheetName={editorState.sheetName}
          onSaved={(result) => {
            mergeLayer1Result(editorState.statementType, {
              lineItems: result.lineItems,
              sourceScaling: result.sourceScaling,
              columnIdentified: result.columnIdentified,
              sourceSheet: editorState.sheetName,
              structured: result.structured,
              templateCheck: result.templateCheck,
            })
            setEditorState(null)
            approveStep1()
          }}
          onCancel={() => setEditorState(null)}
        />
      )
    }

    if (editorState.mode === 'reconcile' && editorState.diff) {
      return (
        <LayoutReconciliation
          oldLayout={editorState.oldLayout ?? []}
          newStepCRows={editorState.stepCRows}
          diff={editorState.diff}
          existingTemplate={editorState.existingTemplate!}
          statementType={editorState.statementType}
          companyId={companyId!}
          sessionId={sessionId!}
          reportingPeriod={reportingPeriod}
          sheetName={editorState.sheetName}
          onSaved={(result) => {
            mergeLayer1Result(editorState.statementType, {
              lineItems: result.lineItems,
              sourceScaling: result.sourceScaling,
              columnIdentified: result.columnIdentified,
              sourceSheet: editorState.sheetName,
              structured: result.structured,
              templateCheck: result.templateCheck,
            })
            setEditorState(null)
            approveStep1()
          }}
          onCancel={() => setEditorState(null)}
        />
      )
    }
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {currentStep === 1 && <Step1Upload />}
      {currentStep === 2 && <Step2Classify />}
      {currentStep === 3 && <Step3Finalize />}
    </div>
  )
}
