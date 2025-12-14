import * as React from "react";

import { cn } from "@/lib/utils";

const ScrollArea = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "relative overflow-y-auto [scrollbar-color:theme(colors.slate.400)_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-400/50 [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar]:w-2",
      className,
    )}
    {...props}
  />
));
ScrollArea.displayName = "ScrollArea";

export { ScrollArea };
