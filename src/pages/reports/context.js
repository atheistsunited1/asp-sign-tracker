// Page-local injection key: ReportsPage provides its composables once; the
// detail cards inject them instead of receiving ~30 props each.
export const REPORTS_CTX = Symbol('reports-ctx')
