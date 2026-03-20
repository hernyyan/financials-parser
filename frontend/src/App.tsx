import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { WizardProvider } from './hooks/useWizardState'
import WizardShell from './components/wizard/WizardShell'
import Header from './components/layout/Header'
import AdminPortal from './components/admin/AdminPortal'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/admin-portal/*" element={<AdminPortal />} />
        <Route path="*" element={
          <WizardProvider>
            <div className="h-screen flex flex-col bg-white overflow-hidden">
              <Header />
              <main className="flex-1 flex flex-col overflow-hidden">
                <WizardShell />
              </main>
            </div>
          </WizardProvider>
        } />
      </Routes>
    </BrowserRouter>
  )
}

export default App
