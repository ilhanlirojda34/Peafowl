import type {
  Answers,
  MissingField,
  SiteDesign,
  SiteGenerationFailure,
  SiteBrief,
  SiteBriefDraft,
} from '@peafowl/generator';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
  type PgTableExtraConfigValue,
} from 'drizzle-orm/pg-core';

const timestamptz = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => timestamptz('created_at').notNull().defaultNow();
const updatedAt = () =>
  timestamptz('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

// -----------------------------------------------------------------------------------------------
// Identity. Column set follows Better Auth's core schema (user, session, account, verification),
// so the auth library can be wired to these tables without reshaping them.
// -----------------------------------------------------------------------------------------------

export const users = pgTable('users', {
  id: uuid().primaryKey().defaultRandom(),
  name: text().notNull(),
  email: text().notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const sessions = pgTable(
  'sessions',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token: text().notNull().unique(),
    expiresAt: timestamptz('expires_at').notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    /** The workspace the session acts in. Membership is verified on every request. */
    activeWorkspaceId: uuid('active_workspace_id').references((): AnyPgColumn => workspaces.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index('sessions_user_id_idx').on(table.userId)],
);

/** A way to sign in: a password (provider "credential") or an OAuth provider. */
export const accounts = pgTable(
  'accounts',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    providerId: text('provider_id').notNull(),
    accountId: text('account_id').notNull(),
    password: text(),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamptz('access_token_expires_at'),
    refreshTokenExpiresAt: timestamptz('refresh_token_expires_at'),
    scope: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('accounts_user_id_idx').on(table.userId),
    uniqueIndex('accounts_provider_account_uq').on(table.providerId, table.accountId),
  ],
);

/** Short-lived tokens: email verification, password reset. */
export const verifications = pgTable(
  'verifications',
  {
    id: uuid().primaryKey().defaultRandom(),
    identifier: text().notNull(),
    value: text().notNull(),
    expiresAt: timestamptz('expires_at').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index('verifications_identifier_idx').on(table.identifier)],
);

// -----------------------------------------------------------------------------------------------
// Tenancy. Projects belong to workspaces, not users. Every user gets a personal workspace; team
// workspaces use the same model. Follows Better Auth's organization plugin (organization, member).
// -----------------------------------------------------------------------------------------------

export const workspaces = pgTable('workspaces', {
  id: uuid().primaryKey().defaultRandom(),
  name: text().notNull(),
  slug: text().notNull().unique(),
  logo: text(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const WORKSPACE_ROLES = ['owner', 'admin', 'member'] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export const workspaceMembers = pgTable(
  'workspace_members',
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text().$type<WorkspaceRole>().notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('workspace_members_workspace_user_uq').on(table.workspaceId, table.userId),
    index('workspace_members_user_id_idx').on(table.userId),
    check('workspace_members_role_check', sql`${table.role} in ('owner', 'admin', 'member')`),
  ],
);

// -----------------------------------------------------------------------------------------------
// Sites. A project is one site. Generations are pipeline runs; each successful run produces an
// immutable site version. The project points at the version that is currently active.
//
// Cross-table references carry the owning project (or workspace) as a second column, so the
// database itself refuses a reference into another project: a project's current version, an
// edit's base version and a version's generation always belong to the same project, and a
// generation's workspace is always its project's workspace.
//
// References between generations and versions use the default NO ACTION: nothing can delete a
// version or generation on its own, while deleting a project still cascades through all of them.
// -----------------------------------------------------------------------------------------------

export const projects = pgTable(
  'projects',
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    currentVersionId: uuid('current_version_id'),
    createdById: uuid('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    /** Soft delete: a deleted project keeps its versions and can be restored. */
    deletedAt: timestamptz('deleted_at'),
  },
  (table): PgTableExtraConfigValue[] => [
    index('projects_workspace_id_idx').on(table.workspaceId),
    unique('projects_id_workspace_uq').on(table.id, table.workspaceId),
    foreignKey({
      name: 'projects_current_version_fk',
      columns: [table.currentVersionId, table.id],
      foreignColumns: [siteVersions.id, siteVersions.projectId],
    }),
  ],
);

export const GENERATION_KINDS = ['create', 'edit'] as const;
export type GenerationKind = (typeof GENERATION_KINDS)[number];

export const GENERATION_STATUSES = [
  'queued',
  'analyzing',
  'awaiting_input',
  'generating',
  'validating',
  'completed',
  'failed',
] as const;
export type GenerationStatus = (typeof GENERATION_STATUSES)[number];

/** Statuses of a generation that is still running. A project has at most one such generation. */
export const ACTIVE_GENERATION_STATUSES = [
  'queued',
  'analyzing',
  'awaiting_input',
  'generating',
  'validating',
] as const satisfies readonly GenerationStatus[];

export const ONE_ACTIVE_GENERATION_PER_PROJECT = 'generations_one_active_per_project_uq';

export type GenerationErrorCode = SiteGenerationFailure | 'unsupported-facts' | 'internal';

/** One round of answers to the questions the pipeline asked. */
export interface AnswerRecord {
  readonly answers: Answers;
  readonly answeredAt: string;
}

export const generationKind = pgEnum('generation_kind', GENERATION_KINDS);
export const generationStatus = pgEnum('generation_status', GENERATION_STATUSES);

export const generations = pgTable(
  'generations',
  {
    id: uuid().primaryKey().defaultRandom(),
    projectId: uuid('project_id').notNull(),
    /** The project's workspace, kept here so quotas count a workspace's generations directly. */
    workspaceId: uuid('workspace_id').notNull(),
    kind: generationKind().notNull().default('create'),
    /** The version an edit starts from. Set exactly when kind is 'edit'. */
    baseVersionId: uuid('base_version_id'),
    /** The user's prompt (create) or change request (edit). */
    prompt: text().notNull(),
    status: generationStatus().notNull().default('queued'),
    /** The analyzed SiteBrief draft, updated as questions are answered. */
    draft: jsonb().$type<SiteBriefDraft>(),
    missingFields: jsonb('missing_fields').$type<readonly MissingField[]>(),
    answers: jsonb().$type<readonly AnswerRecord[]>().notNull().default([]),
    errorCode: text('error_code').$type<GenerationErrorCode>(),
    model: text(),
    promptVersion: text('prompt_version'),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    createdById: uuid('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table): PgTableExtraConfigValue[] => [
    index('generations_project_id_idx').on(table.projectId),
    index('generations_workspace_created_idx').on(table.workspaceId, table.createdAt),
    unique('generations_id_project_uq').on(table.id, table.projectId),
    uniqueIndex(ONE_ACTIVE_GENERATION_PER_PROJECT)
      .on(table.projectId)
      .where(
        sql.raw(
          `status in (${ACTIVE_GENERATION_STATUSES.map((status) => `'${status}'`).join(', ')})`,
        ),
      ),
    foreignKey({
      name: 'generations_project_fk',
      columns: [table.projectId, table.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'generations_base_version_fk',
      columns: [table.baseVersionId, table.projectId],
      foreignColumns: [siteVersions.id, siteVersions.projectId],
    }),
    check(
      'generations_base_version_check',
      sql`(${table.kind} = 'edit') = (${table.baseVersionId} is not null)`,
    ),
  ],
);

/**
 * An immutable snapshot of a site: the brief it was built from and its design. The HTML is not
 * stored; it is rendered from the design. Edits create new versions; old ones are kept for rollback.
 */
export const siteVersions = pgTable(
  'site_versions',
  {
    id: uuid().primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references((): AnyPgColumn => projects.id, { onDelete: 'cascade' }),
    generationId: uuid('generation_id').notNull().unique(),
    version: integer().notNull(),
    brief: jsonb().$type<SiteBrief>().notNull(),
    design: jsonb().$type<SiteDesign>().notNull(),
    createdAt: createdAt(),
  },
  (table): PgTableExtraConfigValue[] => [
    uniqueIndex('site_versions_project_version_uq').on(table.projectId, table.version),
    unique('site_versions_id_project_uq').on(table.id, table.projectId),
    foreignKey({
      name: 'site_versions_generation_fk',
      columns: [table.generationId, table.projectId],
      foreignColumns: [generations.id, generations.projectId],
    }),
  ],
);
