import { useState } from 'react'
import AdminHeader from './AdminHeader'
import AdminSidebar, { AdminSection } from './AdminSidebar'
import CompanyList from './CompanyList'
import ReviewsList from './ReviewsList'
import GeneralFixesList from './GeneralFixesList'
import ChangelogList from './ChangelogList'
import AlertsList from './AlertsList'
import CompanyDetail from './CompanyDetail'

export default function AdminPortal() {
  const [section, setSection] = useState<AdminSection>('companies')
  const [selectedCompanyId, setSelectedCompanyId] = useState<number | null>(null)

  function handleSectionChange(s: AdminSection) {
    setSection(s)
    if (s !== 'companies') setSelectedCompanyId(null)
  }

  function renderContent() {
    if (section === 'companies') {
      if (selectedCompanyId !== null) {
        return (
          <CompanyDetail
            companyId={selectedCompanyId}
            onBack={() => setSelectedCompanyId(null)}
          />
        )
      }
      return <CompanyList onSelect={setSelectedCompanyId} />
    }
    if (section === 'reviews') return <ReviewsList />
    if (section === 'general-fixes') return <GeneralFixesList />
    if (section === 'changelog') return <ChangelogList />
    if (section === 'alerts') return <AlertsList />
    return null
  }

  return (
    <div className="h-screen flex flex-col bg-white overflow-hidden">
      <AdminHeader />
      <div className="flex flex-1 min-h-0">
        <AdminSidebar active={section} onChange={handleSectionChange} />
        <main className="flex-1 overflow-auto">
          {renderContent()}
        </main>
      </div>
    </div>
  )
}
