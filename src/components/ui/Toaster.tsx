import { createPortal } from 'react-dom'
import { useToastStore } from '@/stores/toast'
import { Toast } from './Toast'

export function Toaster() {
  const items = useToastStore((s) => s.items)
  const dismiss = useToastStore((s) => s.dismiss)
  if (items.length === 0) return null
  return createPortal(
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {items.map((item) => (
        <Toast key={item.id} item={item} onDismiss={() => dismiss(item.id)} />
      ))}
    </div>,
    document.body,
  )
}
