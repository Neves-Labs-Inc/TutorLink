// A small stack of Account details: a Child's profile links to Guardian
// details and back again. Only the top entry renders; Back (phone)
// steps down one level, close clears the stack.
import type { ReactNode } from "react";
import { CHILDREN, GUARDIANS } from "@/pages/prototype/shell-kit/kit/mock-data";
import ChildDetail from "@/pages/prototype/shell-kit/screens/child-detail";
import GuardianDetail from "@/pages/prototype/shell-kit/screens/guardian-detail";

export type AccountEntry = { kind: "child" | "guardian"; id: string };

function getName(entry: AccountEntry): string {
  const list = entry.kind === "child" ? CHILDREN : GUARDIANS;
  return list.find((item) => item.id === entry.id)?.name ?? "";
}

type AccountDetailsProps = {
  stack: AccountEntry[];
  onChange: (stack: AccountEntry[]) => void;
  rootLabel: string;
};

export default function AccountDetails({
  stack,
  onChange,
  rootLabel,
}: AccountDetailsProps): ReactNode {
  const top = stack[stack.length - 1];
  if (!top) return null;
  const below = stack[stack.length - 2];
  const backLabel = below ? getName(below) : rootLabel;
  const shared = {
    backLabel,
    onBack: () => onChange(stack.slice(0, -1)),
    onClose: () => onChange([]),
  };
  const child = CHILDREN.find((item) => item.id === top.id);
  const guardian = GUARDIANS.find((item) => item.id === top.id);

  let content: ReactNode = null;
  if (top.kind === "child" && child) {
    content = (
      <ChildDetail
        key={`child-${child.id}`}
        child={child}
        {...shared}
        onOpenGuardian={(next) =>
          onChange([...stack, { kind: "guardian", id: next.id }])
        }
      />
    );
  } else if (top.kind === "guardian" && guardian) {
    content = (
      <GuardianDetail
        key={`guardian-${guardian.id}`}
        guardian={guardian}
        {...shared}
        onOpenChild={(next) => onChange([...stack, { kind: "child", id: next.id }])}
      />
    );
  }
  return content;
}
