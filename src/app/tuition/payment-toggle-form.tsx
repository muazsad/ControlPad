'use client'
import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import { setPaymentStatus } from './actions'

type Props = {
  studentId: string
  periodMonth: string
  currentStatus: 'paid' | 'unpaid'
}

export function PaymentToggleForm({ studentId, periodMonth, currentStatus }: Props) {
  const newStatus = currentStatus === 'paid' ? 'unpaid' : 'paid'
  const label = currentStatus === 'paid' ? 'Mark unpaid' : 'Mark paid'
  const action = setPaymentStatus.bind(null, studentId, periodMonth)
  const [state, formAction] = useActionState(action, undefined)

  return (
    <form action={formAction}>
      <input type="hidden" name="newStatus" value={newStatus} />
      {state?.error && (
        <p className="text-xs text-destructive mb-1">{state.error}</p>
      )}
      <Button type="submit" size="sm" variant="outline">
        {label}
      </Button>
    </form>
  )
}
