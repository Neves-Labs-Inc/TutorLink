// "← Families", the eyebrow of every family page state.
import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { TextLink } from "@/components/kit/components/button";
import { FAMILIES_PATH } from "@/lib/families/family-paths";

export default function FamiliesBackLink(): ReactNode {
  const navigate = useNavigate();

  return (
    <TextLink
      onClick={() => navigate(FAMILIES_PATH)}
      className="-ml-1 text-[14px]"
    >
      <ArrowLeft aria-hidden className="size-4" />
      Families
    </TextLink>
  );
}
