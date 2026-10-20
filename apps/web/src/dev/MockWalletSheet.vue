<script setup lang="ts">
import { pendingApproval } from './mockApproval'
</script>

<template>
  <div v-if="pendingApproval" class="sheet-backdrop" role="presentation">
    <section class="sheet" role="dialog" aria-modal="true" aria-labelledby="mock-sheet-title">
      <p class="text-xs font-semibold uppercase tracking-wide text-gold-1100 mb-1">
        Nimiq Pay · mock wallet
      </p>
      <h2 id="mock-sheet-title" class="text-lg font-bold mb-3">{{ pendingApproval.title }}</h2>
      <dl v-if="pendingApproval.lines.length" class="mb-4">
        <div v-for="line in pendingApproval.lines" :key="line.label" class="row">
          <dt class="row-label">{{ line.label }}</dt>
          <dd class="row-value font-mono text-sm">{{ line.value }}</dd>
        </div>
      </dl>
      <div class="flex gap-3">
        <button type="button" class="btn-secondary flex-1" @click="pendingApproval.resolve(false)">
          Reject
        </button>
        <button type="button" class="btn-primary flex-1" @click="pendingApproval.resolve(true)">
          Approve
        </button>
      </div>
    </section>
  </div>
</template>
