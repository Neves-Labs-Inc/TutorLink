// A small stack of Account details: a Child links to its Guardians and
// a Guardian to their Children. Only the top entry renders; Back (phone)
// steps down one level, close clears the stack.
import type { ReactNode } from "react";
import ChildDetails from "@/pages/prototype/accounts-staff/components/child-details";
import GuardianDetails from "@/pages/prototype/accounts-staff/components/guardian-details";
import { useArea } from "@/pages/prototype/accounts-staff/hooks/use-area-store";
import {
  readChild,
  readClient,
} from "@/pages/prototype/accounts-staff/lib/mock-api";
import type { AccountEntry } from "@/pages/prototype/accounts-staff/types/screens";

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
  const { db } = useArea();
  const top = stack[stack.length - 1];
  if (!top) return null;

  const below = stack[stack.length - 2];
  const belowName = below
    ? (below.kind === "child" ? readChild(db, below.id) : readClient(db, below.id))?.name
    : undefined;
  const shared = {
    backLabel: belowName ?? rootLabel,
    onBack: () => onChange(stack.slice(0, -1)),
    onClose: () => onChange([]),
  };

  let content: ReactNode;
  if (top.kind === "child") {
    const child = readChild(db, top.id);
    content = child && (
      <ChildDetails
        key={`child-${child.id}`}
        child={child}
        {...shared}
        onOpenGuardian={(id) => onChange([...stack, { kind: "guardian", id }])}
      />
    );
  } else {
    const guardian = readClient(db, top.id);
    content = guardian && (
      <GuardianDetails
        key={`guardian-${guardian.id}`}
        guardian={guardian}
        {...shared}
        onOpenChild={(id) => onChange([...stack, { kind: "child", id }])}
      />
    );
  }
  return content;
}
