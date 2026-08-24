// Injection key for the app shell: App.vue provides its session refs and the
// nav / auth / debug composables once; NavDrawer, AccountTray and SettingsTray
// inject them instead of receiving a dozen props each.
export const APP_SHELL_CTX = Symbol('app-shell-ctx')
