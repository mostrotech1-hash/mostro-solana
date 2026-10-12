<script setup lang="ts">
// H02 · Create your account · your profile
const session = useSessionStore();

const name = ref(session.profile?.name ?? "");
const loading = ref(false);
const uploading = ref(false);
const errorMsg = ref("");
const fileInput = ref<HTMLInputElement | null>(null);

async function onFile(event: Event) {
   const file = (event.target as HTMLInputElement).files?.[0];
   if (!file) return;
   errorMsg.value = "";
   uploading.value = true;
   try {
      await session.uploadAvatar(file);
   } catch (error) {
      errorMsg.value = error instanceof Error ? error.message : "Could not upload the picture.";
   } finally {
      uploading.value = false;
   }
}

async function onContinue() {
   errorMsg.value = "";
   loading.value = true;
   try {
      if (name.value.trim()) await session.saveName(name.value.trim());
      await navigateTo("/pass");
   } catch (error) {
      errorMsg.value = error instanceof Error ? error.message : "Could not save your name.";
   } finally {
      loading.value = false;
   }
}
</script>

<template>
   <AppShell title="Set up your profile" :max-width="640">
      <UiCard class="profile">
         <UiStepper :steps="['1 · Your profile', '2 · Your pass', '3 · Done']" :current="1" />
         <h1 class="profile__title">Welcome! Choose your display name.</h1>
         <p class="profile__lead">Quick step, then on to your pass. You can change this anytime.</p>

         <div class="profile__picture">
            <div class="profile__photo">
               <img v-if="session.profile?.avatarUrl" :src="session.profile.avatarUrl" alt="Your profile picture" class="profile__photo-img" />
               <span v-else>Photo</span>
            </div>
            <div class="profile__picture-body">
               <p class="profile__picture-label">Profile picture</p>
               <UiButton variant="pill" :loading="uploading" @click="fileInput?.click()">Upload a photo</UiButton>
               <input ref="fileInput" type="file" accept="image/png,image/jpeg,image/webp" hidden @change="onFile" />
            </div>
         </div>

         <form id="profile-form" class="profile__form" @submit.prevent="onContinue">
            <UiInput v-model="name" caps label="DISPLAY NAME" placeholder="Pauline M." :maxlength="40" autocomplete="nickname" />
            <p class="profile__hint">Shown on your profile. Your wallet address won't change.</p>
            <p v-if="errorMsg" class="profile__error" role="alert">{{ errorMsg }}</p>
            <div class="profile__skip"><UiButton to="/pass" variant="link">Skip for now</UiButton></div>
         </form>

         <div class="profile__footer">
            <UiButton type="submit" form="profile-form" variant="primary" block :loading="loading">Continue</UiButton>
         </div>
      </UiCard>
   </AppShell>
</template>

<style scoped>
.profile {
   display: flex;
   flex: 1;
   flex-direction: column;
   gap: 16px;
}
.profile__title {
   margin: 0;
   font-size: 22px;
   font-weight: 600;
   line-height: 1.2;
}
.profile__lead {
   margin: 0;
   color: var(--m-muted);
   font-size: 13px;
}
.profile__picture {
   display: flex;
   align-items: center;
   gap: 16px;
}
.profile__photo {
   display: flex;
   flex: none;
   align-items: center;
   justify-content: center;
   width: 80px;
   height: 80px;
   overflow: hidden;
   border-radius: 50%;
   background: var(--m-surface-2);
   color: var(--m-muted);
   font-size: 11px;
}
.profile__photo-img {
   width: 100%;
   height: 100%;
   object-fit: cover;
}
.profile__picture-body {
   display: flex;
   flex-direction: column;
   align-items: flex-start;
   gap: 8px;
}
.profile__picture-label {
   margin: 0;
   font-size: 14px;
   font-weight: 600;
}
.profile__form {
   display: flex;
   flex-direction: column;
   gap: 16px;
}
.profile__hint {
   margin: -10px 0 0;
   color: var(--m-muted);
   font-size: 11px;
}
.profile__error {
   margin: 0;
   font-size: 13px;
   color: var(--m-danger);
}
.profile__skip {
   display: flex;
   justify-content: center;
}
/* Phones: Continue is pinned to the bottom of the screen. */
.profile__footer {
   margin-top: auto;
}
@media (min-width: 900px) {
   .profile {
      flex: none;
      gap: 20px;
   }
   .profile__title {
      font-size: 26px;
   }
   .profile__photo {
      width: 96px;
      height: 96px;
   }
   .profile__footer {
      margin-top: 0;
   }
}
</style>
