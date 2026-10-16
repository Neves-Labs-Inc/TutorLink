// Desktop nav (≥1024px): a floating rounded panel with the wordmark,
// the role's nav, and the signed-in person at the foot (opens Profile).
import type { ReactNode } from "react";
import { ChevronRight, UserRound } from "lucide-react";
import { cn } from "@/components/kit/tokens";
import { Avatar, CountBadge } from "@/components/kit/components/badges";
import { Skeleton } from "@/components/kit/states/states";
import { Wordmark } from "@/components/kit/shell/wordmark";
import type { NavId, NavItem } from "@/components/kit/shell/nav";

const PROFILE_LABEL = "Your profile";

type SidebarProps = {
  items: NavItem[];
  activeId: NavId | null;
  onNavigate: (id: NavId) => void;
  // null while the person loads or after it fails to.
  userName: string | null;
  isUserError?: boolean;
  userRole: string;
  onOpenProfile: () => void;
};

export function Sidebar({
  items,
  activeId,
  onNavigate,
  userName,
  isUserError = false,
  userRole,
  onOpenProfile,
}: SidebarProps): ReactNode {
  const isLoading = userName === null && !isUserError;
  const hasFailed = userName === null && isUserError;
  return (
    <aside className="kit-shadow-soft sticky top-4 m-4 mr-0 hidden h-[calc(var(--kit-h)-32px)] w-[248px] shrink-0 flex-col rounded-[28px] border border-(--tl-card-border) bg-(--tl-surface) p-4 @5xl:flex">
      <div className="px-2 pt-2 pb-6">
        <Wordmark />
      </div>
      <nav aria-label="Main" className="flex-1">
        <ul className="flex flex-col gap-1">
          {items.map((item) => {
            const isActive = item.id === activeId;
            const Icon = item.icon;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  aria-current={isActive ? "page" : undefined}
                  onClick={() => onNavigate(item.id)}
                  className={cn(
                    "flex h-11 w-full cursor-pointer items-center gap-3 rounded-full px-4 text-left text-[14px] transition-colors duration-150",
                    isActive
                      ? "bg-(--tl-tint-strong) font-semibold text-(--tl-primary-ink)"
                      : "font-medium text-(--tl-ink-soft) hover:bg-(--tl-tint) active:bg-(--tl-tint-strong)",
                  )}
                >
                  <Icon aria-hidden className="size-[18px]" />
                  <span className="flex-1">{item.label}</span>
                  {item.badge && item.badge.count > 0 ? (
                    <CountBadge
                      count={item.badge.count}
                      tone={item.badge.tone}
                      label={item.badge.label}
                    />
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
      <button
        type="button"
        onClick={onOpenProfile}
        aria-current={activeId === "profile" ? "page" : undefined}
        className={cn(
          "group flex w-full cursor-pointer items-center gap-3 rounded-[20px] p-3 text-left transition-colors duration-150 hover:bg-(--tl-tint-strong) active:bg-(--tl-tint-strong)",
          activeId === "profile"
            ? "bg-(--tl-tint-strong) ring-2 ring-(--tl-primary)"
            : "bg-(--tl-tint)",
          // The skeleton colour all but vanishes on tint; one step darker.
          isLoading && "[--tl-skeleton:var(--tl-tint-strong)]",
        )}
      >
        <PersonAvatar name={userName} isError={isUserError} isOnTint />
        <span
          role={isLoading ? "status" : undefined}
          aria-label={isLoading ? "Loading your profile" : undefined}
          className="min-w-0 flex-1"
        >
          {isLoading ? (
            // h-5 box: the name line's 20px, so nothing shifts on load.
            <span className="flex h-5 items-center">
              <Skeleton className="h-4 w-28 rounded-full" />
            </span>
          ) : (
            <span className="block truncate text-[14px] leading-5 font-semibold">
              {userName ?? PROFILE_LABEL}
            </span>
          )}
          <span className="block text-[13px] leading-[18px] text-(--tl-muted)">
            {userRole}
          </span>
        </span>
        <ChevronRight
          aria-hidden
          className="size-4 text-(--tl-muted) transition-transform duration-150 group-hover:translate-x-0.5 motion-reduce:transform-none"
        />
        {!hasFailed && <span className="sr-only">{PROFILE_LABEL}</span>}
      </button>
    </aside>
  );
}

type PersonAvatarProps = {
  name: string | null;
  isError: boolean;
  // On a tint card the error disc takes the surface, so it still reads.
  isOnTint?: boolean;
};

// The signed-in person's 40px avatar: a skeleton while they load, and a
// plain person disc when they failed to (the Profile page reports it).
export function PersonAvatar({
  name,
  isError,
  isOnTint = false,
}: PersonAvatarProps): ReactNode {
  let avatar: ReactNode;
  if (name !== null) {
    avatar = <Avatar name={name} />;
  } else if (isError) {
    avatar = (
      <span
        aria-hidden
        className={cn(
          "inline-flex size-10 shrink-0 items-center justify-center rounded-full text-(--tl-primary-ink)",
          isOnTint ? "bg-(--tl-surface)" : "bg-(--tl-tint)",
        )}
      >
        <UserRound className="size-5" />
      </span>
    );
  } else {
    avatar = <Skeleton className="size-10 shrink-0 rounded-full" />;
  }
  return avatar;
}
