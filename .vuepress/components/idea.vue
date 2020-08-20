<template>
  <div>{{ num }}</div>
</template>
<script>
import { ref } from '@vue/composition-api'
export default {
  setup() {
    return {
      num: ref(0)
    }
  }
}
</script>
<style lang="scss" scoped>
</style>
