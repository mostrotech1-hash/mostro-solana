<template>
   <span class="ui-badge"><slot /></span>
</template>

<style scoped>
.ui-badge {
   display: inline-block;
   padding: 5px 10px;
   border-radius: 6px;
   background: var(--m-bg);
   color: var(--m-lime);
   font-size: 11px;
   font-weight: 500;
   line-height: 1.4;
}
</style>
