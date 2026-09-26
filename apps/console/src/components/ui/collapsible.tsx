import { useState } from 'react'
import type { ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

export function Collapsible({
  title,
  icon,
  defaultOpen = true,
  children,
  className,
}: {
  title: string
  icon?: ReactNode
  defaultOpen?: boolean
  children: ReactNode
  className?: string
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className={cn('rounded-lg border border-border bg-muted/10', className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        {icon}
        <span className="text-xs font-medium">{title}</span>
        <ChevronDown
          size={14}
          className={
            'ml-auto text-muted-foreground transition-transform duration-300 ' +
            (open ? 'rotate-180' : '')
          }
        />
      </button>
      <div
        className={
          'grid transition-all duration-300 ease-out ' +
          (open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0')
        }
      >
        <div className="overflow-hidden">
          <div className="space-y-3 px-3 pb-3 pt-1">{children}</div>
        </div>
      </div>
    </div>
  )
}
