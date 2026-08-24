// src/router/index.js
import { createRouter, createWebHistory } from 'vue-router'
import Map from '@/pages/map/MapPage.vue'
import Reports from '@/pages/reports/ReportsPage.vue'              // ← renamed file
import BulkPhotoReports from '@/pages/bulk-photos/BulkPhotosPage.vue'
import KmlImport from '@/pages/kml-import/KmlImportPage.vue'
import ManageUsers from '@/pages/manage-users/ManageUsersPage.vue'
import DeletedPins from '@/pages/deleted-pins/DeletedPinsPage.vue'
const Dashboard = () => import('@/pages/dashboard/DashboardPage.vue')   // lazy: ECharts only loads for the dashboard
const Export = () => import('@/pages/export/ExportPage.vue')
import { fetchProfileAccessByUserId, getSession as getAuthSession } from '@/shared/auth/authService'
import { isModeratorRole, isAdminRole } from '@/shared/auth/roles'

const routes = [
  { path: '/', name: 'home', component: Map },
  { path: '/reports', name: 'reports', component: Reports, meta: { requiresAuth: true } },        // auth-only
  { path: '/reports/deleted', name: 'deleted-pins', component: DeletedPins, meta: { requiresMapmaster: true } }, // mapmaster+admin
  { path: '/bulk-photo-reports', name: 'bulk-photo-reports', component: BulkPhotoReports, meta: { requiresAdmin: true } }, // admin-only
  { path: '/import-kml', name: 'import-kml', component: KmlImport, meta: { requiresMapmaster: true } }, // mapmaster+admin
  { path: '/manage-users', name: 'manage-users', component: ManageUsers, meta: { requiresAdmin: true } }, // admin-only
  { path: '/dashboard', name: 'dashboard', component: Dashboard, meta: { requiresMapmaster: true } }, // mapmaster+admin
  { path: '/export', name: 'export', component: Export, meta: { requiresMapmaster: true } }, // mapmaster+admin
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
})
router.beforeEach(async (to) => {
  const requiresAuth      = !!to.meta?.requiresAuth
  const requiresMapmaster = !!to.meta?.requiresMapmaster
  const requiresAdmin     = !!to.meta?.requiresAdmin

  // If the route requires neither, continue
  if (!requiresAuth && !requiresMapmaster && !requiresAdmin) return true

  // --- 1) Session check (shared)
  const { data: { session } } = await getAuthSession()
  if (!session?.user) return { path: '/', replace: true }

  // --- 2) Profile check (approval + role)
  const { data: profileAccess, error } = await fetchProfileAccessByUserId(session.user.id)

  // Any protected route requires an approved account.
  if (error || !profileAccess?.is_approved) return { path: '/', replace: true }
  const role = profileAccess.role

  // --- 3) Role gates
  if (requiresMapmaster) {
    if (!isModeratorRole(role)) {
      return { path: '/', replace: true }
    }
  }

  if (requiresAdmin && !isAdminRole(role)) {
    return { path: '/', replace: true }
  }

  return true
})

export default router
