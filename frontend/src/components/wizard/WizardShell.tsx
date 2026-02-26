import { useWizardState } from '../../hooks/useWizardState'
import StepIndicator from './StepIndicator'
import Step1Upload from './Step1Upload'
import Step2Classify from './Step2Classify'
import Step3Finalize from './Step3Finalize'

export default function WizardShell() {
  const { currentStep } = useWizardState()

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <StepIndicator currentStep={currentStep} />
      <div className="flex-1 overflow-hidden flex flex-col">
        {currentStep === 1 && <Step1Upload />}
        {currentStep === 2 && <Step2Classify />}
        {currentStep === 3 && <Step3Finalize />}
      </div>
    </div>
  )
}
