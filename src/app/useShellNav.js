// App-shell navigation: the menu drawer and the two right-side trays (open
// flags) and the drawer's route actions with their role gates.
import { ref } from 'vue'

/**
 * @param {{ router, user: Ref, isAdmin: Ref, canUseMapOps: Ref, showToast: Function }} deps
 */
export function useShellNav({ router, user, isAdmin, canUseMapOps, showToast }) {
  const menuOpen = ref(false)
  const accountOpen = ref(false)
  const settingsOpen = ref(false)

  function onMenuClick() {
    menuOpen.value = !menuOpen.value   // toggle the drawer
    // ask Map to close its Search/Filter tray
    try { window.dispatchEvent(new Event('app:menu-click')) } catch {}
  }

  function closeAll() {
    accountOpen.value = false
    menuOpen.value = false
    settingsOpen.value = false
  }

  const requireLogin = () => {
    if (user.value) return true
    showToast('Login required.', 'error')
    return false
  }
  const requireMapOps = () => {
    if (canUseMapOps.value) return true
    showToast('Mapmaster or admin required.', 'error')
    return false
  }

  /* menu actions */
  function goReports() {
    menuOpen.value = false
    if (!requireLogin()) return
    router.push({ name: 'reports' })
  }
  function goBulkPhotoReports() {
    menuOpen.value = false
    if (!requireLogin()) return
    if (!isAdmin.value) { showToast('Admin required.', 'error'); return }
    router.push({ name: 'bulk-photo-reports' })
  }
  function goManageUsers() {
    menuOpen.value = false
    router.push({ name: 'manage-users' })
  }
  function goDashboard() {
    menuOpen.value = false
    if (!requireLogin() || !requireMapOps()) return
    router.push({ name: 'dashboard' })
  }
  function goKmlImport() {
    menuOpen.value = false
    if (!requireMapOps()) return
    router.push({ name: 'import-kml' })
  }
  function goExport() {
    menuOpen.value = false
    if (!requireLogin() || !requireMapOps()) return
    router.push({ name: 'export' })
  }
  function goDeletedPins() {
    menuOpen.value = false
    if (!requireLogin() || !requireMapOps()) return
    router.push({ name: 'deleted-pins' })
  }

  return {
    menuOpen, accountOpen, settingsOpen, onMenuClick, closeAll,
    goReports, goBulkPhotoReports, goManageUsers, goDashboard, goKmlImport, goExport, goDeletedPins,
  }
}
