// `/tutors/:id` from before Staff: the old id is the teaching profile's,
// so look up its account and open that Staff member, or the list when
// the profile can't be read.
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Navigate, useParams } from "react-router-dom";
import { tutorQueries } from "@/lib/queries/tutors";

const STAFF_PATH = "/staff";

export default function TutorRedirect(): ReactNode {
  const { id = "" } = useParams();
  const tutor = useQuery({ ...tutorQueries.detail(id), retry: false });

  let content: ReactNode = <div aria-busy="true" />;
  if (tutor.data) {
    content = <Navigate to={`${STAFF_PATH}/${tutor.data.user_id}`} replace />;
  } else if (tutor.isError) {
    content = <Navigate to={STAFF_PATH} replace />;
  }
  return content;
}
