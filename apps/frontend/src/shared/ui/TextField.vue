<script setup lang="ts">
import { useId } from "vue";
defineOptions({ inheritAttrs: false });
defineProps<{
  label: string;
  error?: string;
  hint?: string;
  type?: string;
  autocomplete?: string;
  required?: boolean;
}>();
const value = defineModel<string>({ default: "" });
const id = useId();
</script>
<template>
  <div class="field">
    <label :for="id">{{ label
    }}<span v-if="required" class="muted"> (obligatorio)</span></label>
    <input
      :id="id"
      v-model="value"
      v-bind="$attrs"
      :type="type ?? 'text'"
      :autocomplete="autocomplete"
      :required="required"
      :aria-invalid="!!error"
      :aria-describedby="error || hint ? `${id}-help` : undefined"
    />
    <p
      v-if="error || hint"
      :id="`${id}-help`"
      :class="error ? 'field-error' : 'muted'"
    >
      {{ error || hint }}
    </p>
  </div>
</template>
