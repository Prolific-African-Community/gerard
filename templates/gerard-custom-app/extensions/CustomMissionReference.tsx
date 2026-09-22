import type { MissionCardSlotProps } from '@prolific/gerard-core'

export function CustomMissionReference({ primaryReference, secondaryReference }: MissionCardSlotProps) {
  return <div><strong>{primaryReference}</strong>{secondaryReference ? <small>{secondaryReference}</small> : null}</div>
}
