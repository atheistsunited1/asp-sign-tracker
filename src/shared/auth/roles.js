export function normalizeRole(rawRole) {
  const role = String(rawRole || '').trim().toLowerCase()
  if (role === 'map_master') return 'mapmaster'
  if (role === 'superadmin') return 'admin'
  if (role === 'admin' || role === 'mapmaster' || role === 'user') return role
  return 'user'
}

export function isModeratorRole(rawRole) {
  const role = normalizeRole(rawRole)
  return role === 'mapmaster' || role === 'admin'
}

export function isAdminRole(rawRole) {
  return normalizeRole(rawRole) === 'admin'
}
