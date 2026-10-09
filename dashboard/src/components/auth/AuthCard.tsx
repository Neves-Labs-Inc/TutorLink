import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type AuthCardProps = {
  title: string;
  description: string;
  children: ReactNode;
};

// Login's frame, shared by the two public password pages so they cannot drift from it.
export default function AuthCard({ title, description, children }: AuthCardProps): ReactNode {
  return (
    <div className="grid min-h-dvh w-full place-items-center bg-background px-4 py-10">
      <div className="w-full max-w-sm">
        <Card className="ring-border">
          <CardHeader>
            <CardTitle className="text-xl">{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </CardHeader>
          <CardContent>{children}</CardContent>
        </Card>

        <p className="mt-4 text-center text-sm text-muted-foreground">
          <Link
            to="/login"
            className="inline-block py-3 transition-colors duration-150 ease-out hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none md:py-0"
          >
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
