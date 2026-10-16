// Accounts as Families (Franklin, after the owner's review): one list of
// families, each the Guardians linked through shared Children, with
// their Children. A row opens the family's overview page; Child and
// Guardian details open over it. Admins and Managers see the same page.
import { useState } from "react";
import type { ReactNode } from "react";
import { Archive, Baby, BookUser, SearchX, UserPlus } from "lucide-react";
import { Button } from "@/pages/prototype/shell-kit/kit/components/button";
import { QuickFilter } from "@/pages/prototype/shell-kit/kit/components/quick-filter";
import { PageHeader } from "@/pages/prototype/shell-kit/kit/shell/page-header";
import { PageToolbar } from "@/pages/prototype/shell-kit/kit/shell/page-toolbar";
import { useToast } from "@/pages/prototype/shell-kit/kit/overlays/use-toast";
import {
  EmptyState,
  ErrorState,
  TableSkeleton,
} from "@/pages/prototype/shell-kit/kit/states/states";
import AccountDetails from "@/pages/prototype/accounts-staff/components/account-details";
import AddGuardianSheet from "@/pages/prototype/accounts-staff/components/add-guardian-sheet";
import FamiliesTable from "@/pages/prototype/accounts-staff/components/families-table";
import FamilyPage from "@/pages/prototype/accounts-staff/components/family-page";
import { AddChildSheet } from "@/pages/prototype/accounts-staff/components/guardian-sheets";
import { useArea } from "@/pages/prototype/accounts-staff/hooks/use-area-store";
import { useFamiliesList } from "@/pages/prototype/accounts-staff/hooks/use-families-list";
import { getFamilyTitle } from "@/pages/prototype/accounts-staff/lib/labels";
import { findHousehold } from "@/pages/prototype/accounts-staff/lib/mock-api";
import type {
  AccountEntry,
  Phase,
  Screen,
} from "@/pages/prototype/accounts-staff/types/screens";

// Where each switcher screen starts: which family is open (by one of its
// Guardians) and which details sit on top.
const START: Partial<Record<Screen, { family: string; stack: AccountEntry[] }>> = {
  family: { family: "g-laura", stack: [] },
  child: { family: "g-laura", stack: [{ kind: "child", id: "c-sofia" }] },
  guardian: { family: "g-monica", stack: [{ kind: "guardian", id: "g-monica" }] },
  // Assigned Tutors (TutorLink#243).
  "child-tutors-edit": { family: "g-laura", stack: [{ kind: "child", id: "c-sofia", sheet: "tutors" }] },
  "child-no-tutor": { family: "g-julia", stack: [{ kind: "child", id: "c-emma" }] },
  "mark-evaluated": { family: "g-monica", stack: [{ kind: "child", id: "c-tomas", sheet: "mark-evaluated" }] },
  "mark-evaluated-admin": { family: "g-elena", stack: [{ kind: "child", id: "c-noah", sheet: "mark-evaluated" }] },
};

type AccountsPageProps = {
  phase: Phase;
  onRetry: () => void;
  startScreen: Screen;
  // Opened from Staff details: the Child's family, Child details on top.
  startChildId?: string | null;
};

export default function AccountsPage({ phase, onRetry, startScreen, startChildId }: AccountsPageProps): ReactNode {
  const { db, addChild } = useArea();
  const list = useFamiliesList();
  const start = startChildId
    ? { family: startChildId, stack: [{ kind: "child" as const, id: startChildId }] }
    : START[startScreen];
  const [familyId, setFamilyId] = useState<string | null>(start?.family ?? null);
  const [stack, setStack] = useState<AccountEntry[]>(start?.stack ?? []);
  const [adding, setAdding] = useState<"child" | "guardian" | null>(
    startScreen === "add-account" ? "child" : null,
  );
  const { showToast } = useToast();
  const isReady = phase === "ready";
  const openHousehold = familyId ? findHousehold(db, familyId) : null;

  // A family is opened by any one of its members (Guardian or Child).
  function openFamily(memberId: string): void {
    setFamilyId(memberId);
    setStack([]);
    document.querySelector("[data-kit-scroll]")?.scrollTo({ top: 0 });
  }

  const addButtons = (
    <>
      <Button icon={UserPlus} onClick={() => setAdding("guardian")}>
        Add guardian
      </Button>
      <Button variant="primary" icon={Baby} onClick={() => setAdding("child")}>
        Add child
      </Button>
    </>
  );

  const details = (
    <AccountDetails
      stack={stack}
      onChange={setStack}
      rootLabel={openHousehold ? getFamilyTitle(openHousehold.guardians, openHousehold.children) : "Families"}
    />
  );

  if (isReady && familyId && openHousehold) {
    return (
      <>
        <FamilyPage
          anchorGuardianId={familyId}
          onBack={() => setFamilyId(null)}
          onOpenChild={(id) => setStack([{ kind: "child", id }])}
          onOpenGuardian={(id) => setStack([{ kind: "guardian", id }])}
        />
        {details}
      </>
    );
  }

  let body: ReactNode;
  if (phase === "loading") {
    body = <TableSkeleton columns={4} label="Loading families" />;
  } else if (phase === "error") {
    body = (
      <ErrorState
        title="Couldn’t load families"
        body="Check your connection and try again. Nothing was changed."
        onRetry={onRetry}
      />
    );
  } else if (list.rows.length === 0 && list.isNarrowed) {
    body = (
      <EmptyState
        icon={SearchX}
        title="No families match"
        body="Try a Child’s or Guardian’s name, or a phone number."
        action={<Button onClick={() => list.setQuery("")}>Clear search</Button>}
      />
    );
  } else if (list.rows.length === 0 && list.isArchived) {
    body = (
      <EmptyState
        icon={Archive}
        title="No archived families"
        body="A family shows here once all its Guardians are archived."
      />
    );
  } else if (list.rows.length === 0) {
    body = (
      <EmptyState
        icon={BookUser}
        title="No families yet"
        body="A family starts when a new Guardian answers the Intake questions on WhatsApp. Their Children and Homes join them here."
      />
    );
  } else {
    body = <FamiliesTable rows={list.rows} onOpen={(row) => openFamily(row.key)} />;
  }

  return (
    <>
      <PageHeader
        title="Families"
        description={
          isReady
            ? `${list.totals.families} families · ${list.totals.children} Children · ${list.totals.guardians} Guardians`
            : "Families: the Guardians and the Children they book for."
        }
        // Two equal ways in (Franklin): whichever is added starts a new
        // family. Not PageHeader's primaryAction, which takes one action
        // and hides the rest on phones.
        secondaryActions={addButtons}
      >
        <div className="grid grid-cols-2 gap-2 @3xl:hidden">{addButtons}</div>
        <PageToolbar
          searchLabel="Search families"
          searchPlaceholder="Child, Guardian or phone"
          query={list.query}
          onQueryChange={list.setQuery}
          filters={
            <QuickFilter
              label="Archived"
              icon={Archive}
              isOn={list.isArchived}
              onToggle={() => list.setIsArchived(!list.isArchived)}
            />
          }
        />
      </PageHeader>
      {body}
      {details}
      {adding === "guardian" && (
        <AddGuardianSheet
          childRefs={[]}
          shareableHomes={[]}
          onClose={() => setAdding(null)}
          onCreated={(id) => {
            setAdding(null);
            openFamily(id);
          }}
        />
      )}
      {adding === "child" && (
        <AddChildSheet
          guardians={[]}
          onClose={() => setAdding(null)}
          onSave={(input) => {
            const id = addChild(input);
            setAdding(null);
            showToast({ tone: "success", message: `${input.name} added: a new family. Add a Guardian next.` });
            openFamily(id);
          }}
        />
      )}
    </>
  );
}
