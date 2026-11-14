// Zdania „Ostatnio w organizacji” (bez form rodzajowych: imię osoby stoi osobno, przed zdaniem).
import { pl } from '../i18n/pl'
import type { FeedItem } from '@shared/feed'

export function feedText(i: FeedItem): string {
  const f = pl.feed
  const s = i.subject
  switch (i.kind) {
    case 'contactAdded':
      return f.contactAdded(s, i.contactKind === 'institution')
    case 'contactUpdated':
      return f.contactUpdated(s)
    case 'contactDeleted':
      return f.contactDeleted(s)
    case 'actionAdded':
      return f.actionAdded(s)
    case 'actionUpdated':
      return f.actionUpdated(s)
    case 'actionStatus':
      return f.actionStatus(s, i.actionStatus ? pl.actionStatuses[i.actionStatus] : '')
    case 'actionDeleted':
      return f.actionDeleted(s)
    case 'sessionAdded':
      return f.sessionAdded(s, i.count)
    case 'participantsAdded':
      return f.participantsAdded(s, i.count)
    case 'attendance':
      return f.attendance(s, i.sessionNo ?? 0)
    case 'taskAdded':
      return f.taskAdded(s)
    case 'taskUpdated':
      return f.taskUpdated(s)
    case 'taskDone':
      return f.taskDone(s)
    case 'taskDeleted':
      return f.taskDeleted(s)
    case 'activityAdded':
      return f.activityAdded(i.activityType ? pl.activityTypes[i.activityType] : '', s)
    case 'consentAdded':
      return f.consentAdded(i.consentType ? pl.consentTypes[i.consentType] : '', s)
    case 'topicAdded':
      return f.topicAdded(s)
  }
}
