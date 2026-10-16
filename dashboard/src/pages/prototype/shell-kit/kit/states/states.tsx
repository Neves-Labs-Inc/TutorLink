// Empty, loading, error and access states. Each says what happened and
// what to do next in plain words; none of them shows a code or a stack.
import type { ReactNode } from "react";
import { CloudOff, Lock, RotateCw, TriangleAlert } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { CARD, cn } from "@/pages/prototype/shell-kit/kit/tokens";
import { Button } from "@/pages/prototype/shell-kit/kit/components/button";

type EmptyStateProps = {
  icon: LucideIcon;
  title: string;
  body: string;
  action?: ReactNode;
  tone?: "primary" | "pink" | "yellow" | "green";
  isBare?: boolean;
};

const ICON_TONES = {
  primary: "bg-(--tl-tint) text-(--tl-primary-ink)",
  pink: "bg-(--tl-pink-tint) text-(--tl-pink-ink)",
  yellow: "bg-(--tl-yellow-tint) text-(--tl-yellow-ink)",
  green: "bg-(--tl-green-tint) text-(--tl-green-ink)",
};

export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
  tone = "primary",
  isBare = false,
}: EmptyStateProps): ReactNode {
  return (
    <div
      className={cn(
        "flex flex-col items-center px-6 py-12 text-center",
        !isBare && CARD,
      )}
    >
      <span
        className={cn(
          "inline-flex size-16 items-center justify-center rounded-full",
          ICON_TONES[tone],
        )}
      >
        <Icon aria-hidden className="size-7" />
      </span>
      <h2 className="kit-display mt-5 text-[22px] leading-[30px] font-light">
        {title}
      </h2>
      <p className="mt-1.5 max-w-[42ch] text-[15px] leading-6 text-(--tl-muted)">
        {body}
      </p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

type ErrorStateProps = {
  title: string;
  body: string;
  onRetry: () => void;
  isRetrying?: boolean;
};

export function ErrorState({
  title,
  body,
  onRetry,
  isRetrying = false,
}: ErrorStateProps): ReactNode {
  return (
    <div
      role="alert"
      className={cn(CARD, "flex flex-col items-center px-6 py-12 text-center")}
    >
      <span className="inline-flex size-16 items-center justify-center rounded-full bg-(--tl-danger-tint) text-(--tl-danger)">
        <TriangleAlert aria-hidden className="size-7" />
      </span>
      <h2 className="kit-display mt-5 text-[22px] leading-[30px] font-light">
        {title}
      </h2>
      <p className="mt-1.5 max-w-[42ch] text-[15px] leading-6 text-(--tl-muted)">
        {body}
      </p>
      <div className="mt-6">
        <Button
          variant="primary"
          icon={RotateCw}
          onClick={onRetry}
          isLoading={isRetrying}
        >
          {isRetrying ? "Trying again…" : "Try again"}
        </Button>
      </div>
    </div>
  );
}

type InlineErrorProps = {
  message: string;
  onRetry: () => void;
  isRetrying?: boolean;
};

// One card failing inside a page; ErrorState is for the whole page.
// Copy: `Couldn't load {what}. Check your connection.`
export function InlineError({
  message,
  onRetry,
  isRetrying = false,
}: InlineErrorProps): ReactNode {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[20px] bg-(--tl-danger-tint) py-2 pr-2 pl-4 text-(--tl-danger)"
    >
      <TriangleAlert aria-hidden className="size-4 shrink-0" />
      <p className="min-w-0 flex-1 text-[14px] leading-5 font-medium">
        {message}
      </p>
      <button
        type="button"
        onClick={onRetry}
        disabled={isRetrying}
        className="inline-flex h-11 cursor-pointer items-center gap-1.5 rounded-full px-3 text-[14px] font-semibold underline-offset-4 hover:underline disabled:cursor-default disabled:opacity-70"
      >
        <RotateCw
          aria-hidden
          className={cn("size-4", isRetrying && "animate-spin")}
        />
        {isRetrying ? "Trying again…" : "Try again"}
      </button>
    </div>
  );
}

type PermissionStateProps = { title: string; body: string; action?: ReactNode };

export function PermissionState({
  title,
  body,
  action,
}: PermissionStateProps): ReactNode {
  return (
    <EmptyState
      icon={Lock}
      tone="yellow"
      title={title}
      body={body}
      action={action}
    />
  );
}

type OfflineBannerProps = { onRetry: () => void };

// Sits above the page content; data stays visible but may be stale.
export function OfflineBanner({ onRetry }: OfflineBannerProps): ReactNode {
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-3 rounded-[20px] bg-(--tl-warning-tint) py-2 pr-2 pl-4 text-(--tl-warning)"
    >
      <CloudOff aria-hidden className="size-5 shrink-0" />
      <p className="min-w-0 flex-1 text-[14px] leading-5 font-medium">
        You’re offline. What you see may be out of date; changes won’t save
        until you’re back.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="h-11 cursor-pointer rounded-full px-4 text-[14px] font-semibold underline-offset-4 hover:underline"
      >
        Retry now
      </button>
    </div>
  );
}

type SkeletonProps = { className: string };

export function Skeleton({ className }: SkeletonProps): ReactNode {
  return <span aria-hidden className={cn("kit-skeleton block", className)} />;
}

type ListSkeletonProps = { rows?: number; label: string };

// Mirrors the shape of a list row so the page doesn't jump on load.
export function ListSkeleton({ rows = 4, label }: ListSkeletonProps): ReactNode {
  return (
    <div role="status" aria-label={label} className="flex flex-col gap-3">
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          className={cn(CARD, "flex min-h-[76px] items-center gap-4 px-4 py-3")}
        >
          <Skeleton className="size-12 shrink-0 rounded-[16px]" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-2/5 rounded-full" />
            <Skeleton className="h-3 w-3/5 rounded-full" />
          </div>
          <Skeleton className="hidden h-7 w-24 rounded-full @md:block" />
        </div>
      ))}
    </div>
  );
}

type TableSkeletonProps = { rows?: number; columns?: number; label: string };

export function TableSkeleton({
  rows = 5,
  columns = 5,
  label,
}: TableSkeletonProps): ReactNode {
  return (
    <div role="status" aria-label={label} className={cn(CARD, "overflow-hidden")}>
      <div className="flex h-12 items-center gap-6 border-b border-(--tl-border) px-5">
        {Array.from({ length: columns }, (_, index) => (
          <Skeleton key={index} className="h-3 flex-1 rounded-full" />
        ))}
      </div>
      {Array.from({ length: rows }, (_, row) => (
        <div
          key={row}
          className="flex h-[72px] items-center gap-6 border-b border-(--tl-border) px-5 last:border-b-0"
        >
          <span className="flex flex-1 items-center gap-3">
            <Skeleton className="size-10 shrink-0 rounded-full" />
            <Skeleton className="h-4 flex-1 rounded-full" />
          </span>
          {Array.from({ length: columns - 1 }, (_, column) => (
            <Skeleton key={column} className="h-4 flex-1 rounded-full" />
          ))}
        </div>
      ))}
    </div>
  );
}
