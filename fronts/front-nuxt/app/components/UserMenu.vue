<script setup lang="ts">
/** Right side of the header. Signed in: "My wallet" pill, avatar, name and a menu with Sign out. Guest: the user icon and "Sign in". */
const session = useSessionStore();
const open = ref(false);
const root = ref<HTMLElement | null>(null);
const wallet = useWalletStore();

function onClickOutside(event: MouseEvent) {
   if (root.value && !root.value.contains(event.target as Node)) open.value = false;
}
onMounted(() => {
   document.addEventListener("click", onClickOutside);
   void wallet.refresh();
});
onBeforeUnmount(() => document.removeEventListener("click", onClickOutside));

async function signOut() {
   open.value = false;
   await session.logout();
   wallet.reset();
   await navigateTo("/");
}
</script>

<template>
   <div ref="root" class="user-menu">
      <template v-if="session.profile">
         <WalletBalances to="/wallet" class="user-menu__balances" />
         <NuxtLink to="/wallet" class="user-menu__wallet">My wallet</NuxtLink>
         <div class="user-menu__anchor">
            <button type="button" class="user-menu__trigger" aria-haspopup="menu" :aria-expanded="open" @click="open = !open">
               <UiAvatar :src="session.profile.avatarUrl" :name="session.profile.name ?? session.profile.email" :size="32" class="user-menu__avatar" />
               <span class="user-menu__name">{{ session.profile.name ?? session.profile.email }}</span>
               <svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" class="user-menu__chevron">
                  <path d="M2.5 4.5L6 8l3.5-3.5" />
               </svg>
            </button>
            <div v-if="open" class="user-menu__panel" role="menu">
               <button type="button" role="menuitem" class="user-menu__item" @click="signOut">Sign out</button>
            </div>
         </div>
      </template>
      <NuxtLink v-else to="/" class="user-menu__trigger">
         <UiAvatar :size="32" class="user-menu__avatar" />
         <span class="user-menu__name">Sign in</span>
      </NuxtLink>
   </div>
</template>

<style scoped>
.user-menu {
   display: flex;
   align-items: center;
   gap: 28px;
}
.user-menu__anchor {
   position: relative;
}
.user-menu__trigger {
   display: flex;
   align-items: center;
   gap: 8px;
   padding: 0;
   border: 0;
   background: none;
   color: var(--m-text);
   font-size: 14px;
   text-decoration: none;
   cursor: pointer;
}
.user-menu__wallet,
.user-menu__balances,
.user-menu__name,
.user-menu__chevron {
   display: none;
}
.user-menu__panel {
   position: absolute;
   right: 0;
   top: calc(100% + 10px);
   min-width: 160px;
   padding: 6px;
   border-radius: 12px;
   background: var(--m-surface);
   border: 1px solid var(--m-border);
}
.user-menu__item {
   width: 100%;
   padding: 10px 12px;
   border: 0;
   border-radius: 8px;
   background: none;
   color: var(--m-text);
   font-size: 14px;
   text-align: left;
   cursor: pointer;
}
.user-menu__item:hover {
   background: var(--m-surface-2);
}
@media (min-width: 900px) {
   .user-menu__balances {
      display: inline-flex;
   }
   .user-menu__wallet {
      display: inline-block;
      padding: 7px 12px;
      border: 1px solid var(--m-border);
      border-radius: 30px;
      color: var(--m-text);
      font-size: 13px;
      font-weight: 600;
      text-decoration: none;
   }
   .user-menu__name,
   .user-menu__chevron {
      display: inline;
   }
   .user-menu__trigger :deep(.ui-avatar) {
      width: 40px !important;
      height: 40px !important;
   }
}
</style>
