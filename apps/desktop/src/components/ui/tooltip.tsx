import * as React from "react"
import * as TooltipPrimitive from "@radix-ui/react-tooltip"

import { cn } from "@/lib/utils"

function composeEventHandlers<E>(
  userHandler: ((event: E) => void) | undefined,
  internalHandler: (event: E) => void,
) {
  return (event: E) => {
    userHandler?.(event)
    internalHandler(event)
  }
}

const TooltipProvider = ({
  delayDuration = 200,
  skipDelayDuration = 300,
  disableHoverableContent = true,
  ...props
}: React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Provider>) => (
  <TooltipPrimitive.Provider
    delayDuration={delayDuration}
    skipDelayDuration={skipDelayDuration}
    disableHoverableContent={disableHoverableContent}
    {...props}
  />
)

const Tooltip = ({
  disableHoverableContent = true,
  ...props
}: React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Root>) => (
  <TooltipPrimitive.Root
    disableHoverableContent={disableHoverableContent}
    {...props}
  />
)

const TooltipTrigger = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Trigger>
>(({ onPointerDownCapture, onClickCapture, onBlurCapture, ...props }, ref) => {
  const pointerOpenedRef = React.useRef(false)

  return (
    <TooltipPrimitive.Trigger
      ref={ref}
      onPointerDownCapture={composeEventHandlers(onPointerDownCapture, (event) => {
        if (event.pointerType === "mouse" || event.pointerType === "touch" || event.pointerType === "pen") {
          pointerOpenedRef.current = true
        }
      })}
      onClickCapture={composeEventHandlers(onClickCapture, (event) => {
        if (!pointerOpenedRef.current) return
        pointerOpenedRef.current = false

        if (event.currentTarget instanceof HTMLElement) {
          event.currentTarget.blur()
        }
      })}
      onBlurCapture={composeEventHandlers(onBlurCapture, () => {
        pointerOpenedRef.current = false
      })}
      {...props}
    />
  )
})
TooltipTrigger.displayName = TooltipPrimitive.Trigger.displayName

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, collisionPadding = 8, ...props }, ref) => (
  <TooltipPrimitive.Content
    ref={ref}
    sideOffset={sideOffset}
    collisionPadding={collisionPadding}
    className={cn(
      "z-[200] overflow-hidden rounded-lg bg-neutral-900 px-3 py-2 text-xs text-white shadow-lg",
      className
    )}
    {...props}
  />
))
TooltipContent.displayName = TooltipPrimitive.Content.displayName

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
