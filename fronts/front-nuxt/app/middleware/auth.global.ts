/** `/` and `/oauth/callback` are public. Every other page needs a signed-in user with a wallet. */
export default defineNuxtRouteMiddleware(async (to) => {
   if (import.meta.server || to.path === "/oauth/callback") return;
   const session = useSessionStore();

   try {
      await session.init();
   } catch (error) {
      console.error("[mostro] could not restore the session", error);
   }

   if (to.path === "/") {
      // Already signed in: skip the sign-in screen.
      if (session.isAuthenticated) return navigateTo(session.profile?.name ? "/pass" : "/profile");
      return;
   }
   if (!session.isAuthenticated) return navigateTo("/");
});
