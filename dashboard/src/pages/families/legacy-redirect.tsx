// Old /children(/:id) and /guardians(/:id) URLs, sent on to Families.
import type { ReactNode } from "react";
import { Navigate, useParams } from "react-router-dom";
import { getLegacyRedirect } from "@/lib/families/family-paths";
import type { DetailKind } from "@/lib/families/family-paths";

type LegacyRedirectProps = { kind: DetailKind };

export default function LegacyRedirect({
  kind,
}: LegacyRedirectProps): ReactNode {
  const { id } = useParams();
  return <Navigate to={getLegacyRedirect(kind, id)} replace />;
}
