<script setup lang="ts">
import { pendingApproval } from './mockApproval'
</script>

<template>
  <div v-if="pendingApproval" class="sheet-backdrop" role="presentation">
    <section class="sheet" role="dialog" aria-modal="true" aria-labelledby="mock-sheet-title">
      <div
        style="
          width: 40px;
          height: 5px;
          border-radius: 3px;
          background: var(--fy-line);
          margin: -8px auto 14px;
        "
      />
      <p class="fy-eyebrow" style="color: var(--fy-warning); margin: 0 0 6px">
        Nimiq Pay · mock wallet
      </p>
      <h2 id="mock-sheet-title" class="fy-title" style="margin-bottom: 12px">
        {{ pendingApproval.title }}
      </h2>
      <dl v-if="pendingApproval.lines.length" class="fy-panel" style="margin-bottom: 16px">
        <div v-for="line in pendingApproval.lines" :key="line.label" class="fy-row">
          <dt class="fy-row__k">{{ line.label }}</dt>
          <dd class="fy-row__v" style="font-weight: 600; word-break: break-all">
            {{ line.value }}
          </dd>
        </div>
      </dl>
      <div class="fy-bottom--split" style="display: grid">
        <button
          type="button"
          class="fy-btn fy-btn--secondary"
          @click="pendingApproval.resolve(false)"
        >
          Reject
        </button>
        <button type="button" class="fy-btn fy-btn--primary" @click="pendingApproval.resolve(true)">
          Approve
        </button>
      </div>
    </section>
  </div>
</template>
