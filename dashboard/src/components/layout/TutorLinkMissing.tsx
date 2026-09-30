import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export const TutorLinkMissing = () => (
  <Card>
    <CardHeader>
      <CardTitle>No tutor profile linked</CardTitle>
      <CardDescription>
        Your account isn&apos;t linked to a tutor profile yet. Ask an admin to link it before this
        page can show your data.
      </CardDescription>
    </CardHeader>
  </Card>
)
