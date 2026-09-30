import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { HomeDraft } from '@/lib/homes/homes'

export type HomeFieldsProps = {
  idPrefix: string
  value: HomeDraft
  onChange: (next: HomeDraft) => void
  disabled?: boolean
}

export const HomeFields = ({ idPrefix, value, onChange, disabled = false }: HomeFieldsProps) => (
  <div className="space-y-4">
    <div className="space-y-1.5">
      <Label htmlFor={`${idPrefix}-label`}>Label (optional)</Label>
      <Input
        id={`${idPrefix}-label`}
        placeholder="Mum's / Dad's"
        autoComplete="off"
        value={value.label}
        disabled={disabled}
        onChange={(event) => onChange({ ...value, label: event.target.value })}
      />
    </div>
    <div className="space-y-1.5">
      <Label htmlFor={`${idPrefix}-address`}>Address</Label>
      <Input
        id={`${idPrefix}-address`}
        autoComplete="off"
        value={value.address}
        disabled={disabled}
        onChange={(event) => onChange({ ...value, address: event.target.value })}
      />
    </div>
    <div className="space-y-1.5">
      <Label htmlFor={`${idPrefix}-access-code`}>Access code</Label>
      <Input
        id={`${idPrefix}-access-code`}
        autoComplete="off"
        value={value.accessCode}
        disabled={disabled}
        onChange={(event) => onChange({ ...value, accessCode: event.target.value })}
      />
    </div>
  </div>
)
