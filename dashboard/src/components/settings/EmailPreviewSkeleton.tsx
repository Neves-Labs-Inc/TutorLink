import { SKELETON_BAR } from "@/components/settings/emailTemplateClasses";
import { cn } from "@/lib/utils";

// Same border, header and fixed body height as the real inbox frame, so nothing shifts on load.
export default function EmailPreviewSkeleton(): React.ReactNode {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="space-y-2 border-b border-border px-4 py-3">
        <div className={cn(SKELETON_BAR, "h-6 w-3/4")} />
        <div className="flex items-center gap-3">
          <div className={cn(SKELETON_BAR, "size-8 shrink-0 rounded-full")} />
          <div className="flex flex-col gap-2">
            <div className={cn(SKELETON_BAR, "h-4 w-20")} />
            <div className={cn(SKELETON_BAR, "h-3 w-24")} />
          </div>
        </div>
      </div>
      <div className="h-144 space-y-3 p-6">
        <div className={cn(SKELETON_BAR, "h-5 w-24")} />
        <div className={cn(SKELETON_BAR, "h-4 w-full")} />
        <div className={cn(SKELETON_BAR, "h-4 w-5/6")} />
        <div className={cn(SKELETON_BAR, "h-4 w-2/3")} />
        <div className={cn(SKELETON_BAR, "h-11 w-40")} />
        <div className={cn(SKELETON_BAR, "h-3 w-56 max-w-full")} />
        <div className={cn(SKELETON_BAR, "h-3 w-full")} />
      </div>
    </div>
  );
}
