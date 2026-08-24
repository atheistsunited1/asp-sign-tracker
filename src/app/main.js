import { createApp, h } from 'vue'
import App from '@/app/App.vue'
import router from '@/app/router'
import ToastHost from '@/shared/ui/ToastHost.vue'
import ConfirmHost from '@/shared/ui/ConfirmHost.vue'
import { onAuthStateChange } from '@/shared/auth/authService'

const app = createApp({
  render: () =>
    h(ConfirmHost, null, {
      default: () => h(ToastHost, null, { default: () => h(App) }),
    }),
})

app.use(router)          // add other plugins here before mount
app.mount('#app')

// 🔒 If the user signs out while on a protected page, bounce home.
onAuthStateChange((event, session) => {
  if (event === 'SIGNED_OUT' || event === 'USER_DELETED' || !session?.user) {
    const cur = router.currentRoute.value
    const needsAuth = !!cur.meta?.requiresAuth || !!cur.meta?.requiresAdmin
    // Use replace so Back won’t return to the protected page
    if (needsAuth || cur.path !== '/') router.replace({ name: 'home' })
  }
})
