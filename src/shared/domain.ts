// Słowniki domeny: wartości zapisywane w bazie (tekst + unia typów w TS).
// Polskie etykiety są w src/client/i18n/pl.ts.

export const CONTACT_KINDS = ['person', 'institution'] as const
export type ContactKind = (typeof CONTACT_KINDS)[number]

export const ROLES = ['participant', 'volunteer', 'donor', 'member', 'partner', 'trainer', 'staff', 'other'] as const
export type Role = (typeof ROLES)[number]

export const RELATIONSHIP_TYPES = ['works_at', 'contact_person', 'guardian', 'other'] as const
export type RelationshipType = (typeof RELATIONSHIP_TYPES)[number]

export const CONSENT_TYPES = ['processing', 'image', 'communication', 'other'] as const
export type ConsentType = (typeof CONSENT_TYPES)[number]

export const ACTIVITY_TYPES = ['note', 'contact', 'support', 'system'] as const
export type ActivityType = (typeof ACTIVITY_TYPES)[number]

export const CHANNELS = ['phone', 'email', 'meeting', 'other'] as const
export type Channel = (typeof CHANNELS)[number]

export const ACTION_TYPES = ['training', 'workshop', 'event', 'meeting', 'fundraiser', 'other'] as const
export type ActionType = (typeof ACTION_TYPES)[number]

export const FRAMEWORKS = ['project', 'statutory_free', 'statutory_paid', 'business'] as const
export type Framework = (typeof FRAMEWORKS)[number]

export const ACTION_STATUSES = ['planned', 'ongoing', 'done', 'cancelled'] as const
export type ActionStatus = (typeof ACTION_STATUSES)[number]

export const PARTICIPANT_STATUSES = ['registered', 'confirmed', 'resigned'] as const
export type ParticipantStatus = (typeof PARTICIPANT_STATUSES)[number]

export const ATTENDANCE_STATUSES = ['present', 'absent', 'excused'] as const
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number]

export const TASK_STATUSES = ['todo', 'doing', 'done'] as const
export type TaskStatus = (typeof TASK_STATUSES)[number]

export const PRIORITIES = ['low', 'normal', 'high'] as const
export type Priority = (typeof PRIORITIES)[number]

/** Słowo, które administrator wpisuje, żeby potwierdzić anonimizację osoby (D12). */
export const ANONYMIZE_CONFIRM = 'ANONIMIZUJ'

export const TARGET_TYPES = ['contact', 'action'] as const
export type TargetType = (typeof TARGET_TYPES)[number]

// Słowniki działań v2 i materiałów (desktop: ITEM_STATUSES, BUDGET_STATUSES, LINK_TARGETS, FILE_PURPOSES,
// NOTE_KINDS, NOTE_TARGETS) dojdą z ZADANIEM_05. Role użytkowników: src/shared/api.ts, profile: src/shared/modules.ts.

export const OP_TYPES = ['insert', 'update', 'delete', 'restore', 'anonymize'] as const
export type OpType = (typeof OP_TYPES)[number]

export type RoleLabels = Partial<Record<Role, string>>
