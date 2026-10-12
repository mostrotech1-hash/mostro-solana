<template>
   <div class="welcome">
      <div class="welcome__copy">
         <p class="welcome__title">Welcome to Mostro</p>
         <p class="welcome__text">One account for your perks, drops and events.</p>
      </div>
      <UiMascot :size="96" />
   </div>
</template>

<style scoped>
.welcome {
   display: flex;
   align-items: center;
   gap: 8px;
   min-height: 124px;
   padding: 0 12px 0 22px;
   border-radius: 20px;
   background: linear-gradient(156deg, #6953da 0%, #4995e0 36.667%, rgba(113, 214, 251, 0.9) 66.667%);
   overflow: hidden;
}
.welcome__copy {
   flex: 1;
   min-width: 0;
}
.welcome__title {
   margin: 0 0 4px;
   font-size: clamp(18px, 5.6vw, 22px);
   font-weight: 600;
}
.welcome__text {
   margin: 0;
   font-size: 13px;
}
</style>
