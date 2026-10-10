import * as React from "react";
import { Eye, EyeOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type PasswordInputProps = Omit<React.ComponentProps<"input">, "type">;

export function PasswordInput({
  className,
  ...props
}: PasswordInputProps): React.ReactNode {
  const [isVisible, setIsVisible] = React.useState(false);
  const Icon = isVisible ? EyeOff : Eye;

  return (
    <div className="relative">
      <Input
        {...props}
        type={isVisible ? "text" : "password"}
        className={cn("pr-10", className)}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={isVisible ? "Hide password" : "Show password"}
        aria-pressed={isVisible}
        disabled={props.disabled}
        onClick={() => setIsVisible((current) => !current)}
        className="absolute inset-y-0 right-1 my-auto text-muted-foreground before:absolute before:-inset-2 before:content-['']"
      >
        <Icon aria-hidden="true" />
      </Button>
    </div>
  );
}
