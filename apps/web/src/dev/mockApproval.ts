import { shallowRef } from 'vue'

export interface ApprovalRequest {
  title: string
  lines: { label: string; value: string }[]
  resolve: (approved: boolean) => void
}

/** The approval the mock wallet is currently asking for, shown by MockWalletSheet. */
export const pendingApproval = shallowRef<ApprovalRequest | null>(null)

export function askApproval(title: string, lines: ApprovalRequest['lines'] = []): Promise<boolean> {
  return new Promise((resolve) => {
    pendingApproval.value = {
      title,
      lines,
      resolve: (approved) => {
        pendingApproval.value = null
        resolve(approved)
      },
    }
  })
}
