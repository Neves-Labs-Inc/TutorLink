// Subjects: the catalogue Tutors teach from. Lists Active and Archived,
// and adds or edits one in a sheet. It saves on its own and never takes
// the Settings form, so a page without that form can render it alone.
import type { ReactNode } from "react";
import { Archive, BookOpen, Plus } from "lucide-react";
import { Button, IconButton } from "@/components/kit/components/button";
import { DataTable } from "@/components/kit/components/data-table";
import type { Column } from "@/components/kit/components/data-table";
import { Pager } from "@/components/kit/components/pager";
import { SectionCard } from "@/components/kit/components/section-card";
import { SubPageTabs } from "@/components/kit/components/tabs";
import { pluralize } from "@/components/kit/format";
import {
  EmptyState,
  InlineError,
  TableSkeleton,
} from "@/components/kit/states/states";
import type { Subject } from "@/lib/queries/subjects";
import { spanishNameDisplay } from "@/lib/subjects/subjects";
import SubjectSheet from "@/pages/settings/components/subject-sheet";
import {
  SUBJECT_PAGE_SIZE,
  useSubjectsGroup,
} from "@/pages/settings/hooks/use-subjects-group";
import type { SubjectTab } from "@/pages/settings/hooks/use-subjects-group";

const TABS = [
  { id: "active", label: "Active" },
  { id: "archived", label: "Archived" },
];

const COLUMNS: Column<Subject>[] = [
  {
    id: "name",
    header: "Name",
    render: (subject) => (
      <span className="text-[15px] leading-6 font-semibold">
        {subject.name}
      </span>
    ),
  },
  {
    id: "name_es",
    header: "Spanish name",
    render: (subject) =>
      subject.name_es ?? (
        <span className="text-(--tl-muted)">{spanishNameDisplay(null)}</span>
      ),
  },
  {
    id: "tutors",
    header: "Tutors",
    width: "96px",
    render: (subject) => (
      <span className="tabular-nums">{subject.tutor_count}</span>
    ),
  },
];

function getPhoneRow(subject: Subject) {
  return {
    title: subject.name,
    subtitle: `Spanish: ${subject.name_es ?? "English name used"}`,
    meta: pluralize(subject.tutor_count, "tutor", "tutors"),
  };
}

export default function SubjectsGroup(): ReactNode {
  const group = useSubjectsGroup();

  let list: ReactNode;
  if (group.isLoading) {
    list = <TableSkeleton columns={3} rows={5} label="Loading Subjects" />;
  } else if (group.isFailed) {
    list = (
      <InlineError
        message="Couldn’t load Subjects. Check your connection."
        onRetry={group.retry}
        isRetrying={group.isRetrying}
      />
    );
  } else if (group.subjects?.length === 0 && group.page <= 1) {
    list = (
      <div className="rounded-[16px] bg-(--tl-surface-sunk)">
        <EmptyState
          isBare
          icon={group.isArchivedTab ? Archive : BookOpen}
          tone={group.isArchivedTab ? undefined : "primary"}
          title={
            group.isArchivedTab ? "No archived subjects" : "No subjects yet"
          }
        />
      </div>
    );
  } else {
    list = (
      <DataTable
        caption={group.isArchivedTab ? "Archived subjects" : "Active subjects"}
        rows={group.subjects ?? []}
        columns={COLUMNS}
        getRowId={(subject) => subject.id}
        getRowTitle={(subject) => subject.name}
        getPhoneRow={getPhoneRow}
        onOpenRow={group.openSheet}
      />
    );
  }

  return (
    <SectionCard
      id="subjects"
      title="Subjects"
      description="The Subjects Tutors teach and the bot offers. Open one to change it."
    >
      <div className="flex items-end gap-3">
        <div className="min-w-0 flex-1">
          <SubPageTabs
            label="Subject lists"
            items={TABS}
            activeId={group.tab}
            // Ids come from TABS.
            onChange={(id) => group.changeTab(id as SubjectTab)}
          />
        </div>
        <IconButton
          variant="outline"
          icon={Plus}
          label="Add subject"
          className="@2xl:hidden"
          onClick={() => group.openSheet(null)}
        />
        <span className="hidden @2xl:inline-flex">
          <Button
            variant="soft"
            icon={Plus}
            onClick={() => group.openSheet(null)}
          >
            Add subject
          </Button>
        </span>
      </div>
      {list}
      {!group.isLoading && !group.isFailed && (
        <Pager
          page={group.page}
          pageSize={SUBJECT_PAGE_SIZE}
          total={group.total}
          onPageChange={group.changePage}
          label="Subject pages"
          isDisabled={group.isPageLoading}
        />
      )}
      <SubjectSheet
        key={group.sheet.key}
        isOpen={group.sheet.isOpen}
        subject={group.sheet.subject}
        onClose={group.closeSheet}
        onAdded={group.handleAdded}
      />
    </SectionCard>
  );
}
