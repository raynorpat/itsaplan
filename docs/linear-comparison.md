# Linear compared with It's a Plan

It's a Plan follows Linear's data model and serves Linear's GraphQL API, so the concepts and
most of the API carry over. This page lists, area by area, what matches Linear, what works
differently, and what is not built yet. It also lists what It's a Plan adds.

Status key: **Yes** — works like Linear. **Partial** — works, with the difference noted.
**No** — not built.

## Work tracking

| Linear feature                                  | Status  | Notes                                                                                              |
| ----------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------- |
| Issues: priority, assignee, due date, labels    | Yes     |                                                                                                    |
| Sub-issues and parent issues                    | Yes     |                                                                                                    |
| Issue relations: blocks, related, duplicate     | Yes     | a new duplicate is moved to the team's canceled state                                              |
| Estimates with team scales                      | Yes     | exponential, Fibonacci, linear, T-shirt; extended scale and zero; off by default                   |
| Workflow states per team | Yes | |
| Triage and triage responsibility | No | no triage state or team triage setting |
| Issue templates                                 | Yes     | issue templates only; no document or project templates                                             |
| Recurring issues, reminders                     | No      |                                                                                                    |
| Comments: threads, resolve, reactions           | Yes     |                                                                                                    |
| Custom emoji                                    | No      |                                                                                                    |
| Attachments and links on issues                 | Yes     | uploads stored in the instance's own S3-compatible storage                                        |
| Documents in projects and issues                | Partial | no version history                                                                                 |
| Issue history and activity                      | Yes     |                                                                                                    |
| Subscriptions and the notification inbox | Partial | issue subscriptions and the inbox; team, project and view notification subscriptions are not served |
| Email notifications                             | Yes     | per Linear category, per person                                                                    |
| Push and desktop notifications                  | No      |                                                                                                    |
| Auto-archive and auto-close                     | Partial | auto-archive only                                                                                  |
| Workflow automations                            | Yes     | team automations on create and update, with Linear's conditions and actions                        |

## Planning

| Linear feature                                  | Status  | Notes                                                                                              |
| ----------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------- |
| Cycles                                          | Yes     | created automatically per team; unfinished issues roll over                                        |
| Projects: milestones, updates, health, members  | Yes     |                                                                                                    |
| Project statuses                                | Partial | the six standard statuses; custom statuses cannot be created                                       |
| Project labels                                  | Partial | cannot be retired                                                                                  |
| Project progress and history                    | Yes     |                                                                                                    |
| Project dependencies                            | Yes     | start, end and milestone anchors; cycles refused                                                   |
| Projects timeline                               | Yes     | bars, milestones, date dragging, grouping, dependency arrows                                       |
| Initiatives and sub-initiatives                 | Partial | no initiative labels                                                                               |
| Roadmaps (legacy)                               | No      | initiatives replace them, as in Linear                                                             |
| Releases and release pipelines                  | Yes     | continuous and scheduled; CI sync with access keys; release notes                                  |
| Time schedules and SLAs                         | No      |                                                                                                    |

## Views and navigation

| Linear feature                                  | Status  | Notes                                                                                              |
| ----------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------- |
| List, board, timeline and calendar layouts      | Yes     |                                                                                                    |
| Display options, grouping and ordering          | Yes     | Linear's orderings, including estimate, cycle, project, label and release                          |
| Saved views                                     | Yes     |                                                                                                    |
| My issues, inbox                                | Yes     |                                                                                                    |
| Favorites and folders                           | Partial | initiatives cannot be favorited (Linear's API has no field for them)                               |
| Command palette and keyboard shortcuts          | Yes     |                                                                                                    |
| Search                                          | Partial | issue search; no semantic search                                                                   |
| Real-time updates                               | Partial | the web app refreshes changes every 60 seconds instead of Linear's live sync                       |
| Desktop and mobile apps                         | No      | web app only                                                                                       |

## Insights and customers

| Linear feature                                  | Status  | Notes                                                                                              |
| ----------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------- |
| Insights                                        | Yes     | computed in the browser from what the viewer can see                                               |
| Dashboards                                      | Yes     | charts, numbers, tables, CSV export; five templates                                                |
| Customer requests (`CustomerNeed`)              | Yes     |                                                                                                    |
| Customers: domains, owners, statuses, tiers     | Yes     | off by default                                                                                     |
| Asks (Slack intake), email intake addresses     | No      |                                                                                                    |
| CSV export of issues                            | No      | dashboards and the audit log export CSV                                                            |

## Workspace, access and security

| Linear feature                                  | Status  | Notes                                                                                              |
| ----------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------- |
| Roles: owner, admin, member, guest              | Yes     |                                                                                                    |
| Private teams                                   | Yes     |                                                                                                    |
| Sub-teams                                       | No      |                                                                                                    |
| Invites and approved email domains              | Yes     |                                                                                                    |
| Sign-in: email link, Google, passkey            | Yes     | no passwords                                                                                       |
| SAML single sign-on and SCIM                    | No      |                                                                                                    |
| Session management | Partial | sign-out in the web app; no session list; Linear's session queries and mutations are not served |
| Audit log                                       | Yes     | security-relevant actions; 30-day retention by default, up to forever                              |
| Issue sharing outside the workspace             | No      | the client portal covers sharing with outside people                                               |

## Integrations and developer platform

| Linear feature                                  | Status  | Notes                                                                                              |
| ----------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------- |
| GraphQL API and `@linear/sdk`                   | Partial | 92 of 159 queries and 166 of 336 mutations; see [API coverage](#api-coverage)                      |
| Personal API keys                               | Yes     |                                                                                                    |
| OAuth applications and scopes                   | Yes     | including `actor=app` installs                                                                     |
| Agent API (agent sessions, delegation)          | Yes     |                                                                                                    |
| MCP server                                      | Yes     | Linear's tool set, full and read-only                                                              |
| Webhooks                                        | Yes     | Linear's format and signature                                                                      |
| GitHub, GitLab: linked pull requests, git automations | No |                                                                                                   |
| Slack, Discord, Microsoft Teams                 | No      |                                                                                                    |
| Figma, Sentry, Zendesk, Intercom, Front, Salesforce, Gong | No |                                                                                                |
| Jira sync                                       | No      | Jira CSV import only                                                                               |
| Imports                                         | Partial | GitHub, GitLab, Gitea, Forgejo, Jira CSV and any CSV; no Asana, Shortcut or Jira API import        |
| AI features                                     | Partial | an OpenAI-compatible endpoint you configure writes requester summaries; nothing else uses AI       |

## Beyond Linear

| Feature                      | What it does                                                                                              |
| ---------------------------- | --------------------------------------------------------------------------------------------------------- |
| Self-hosting                 | your server, your database, no per-seat fees; one `docker compose up`                                     |
| Client portal                | public, restricted or per-customer boards where outside people vote, comment and suggest                  |
| Intake forms                 | issue templates published as forms, with an email confirmation step                                      |
| Requester updates            | people who asked for something get emails when it changes or ships, and weekly or daily summaries        |
| Feedback people (requesters) | people outside the workspace who give feedback, merged and blocked like contacts                         |
| More import sources          | GitLab, Gitea, Forgejo, and any CSV with column and status mapping                                       |

## API coverage

The instance serves every root query and mutation that its features need. A root field of
Linear's schema that is not served answers with `NOT_IMPLEMENTED`; other fields always
return a value. Most of what is missing belongs to the integrations above.

<!-- Generated from the resolvers registered in apps/api/src/graphql/mount.ts against
     apps/api/src/graphql/schema.graphql. Regenerate when resolvers change. -->

<details>
<summary>Queries not implemented (67)</summary>

`administrableTeams`, `agentSkill`, `agentSkills`, `applicationInfo`, `archivedIntegrations`, `attachmentSources`, `authenticationSessions`, `availableUsers`, `customViewHasSubscribers`, `dependencyPackageMetadata`, `documentContentHistory`, `emailIntakeAddress`, `emailIntakeAddresses`, `emoji`, `emojis`, `entityExternalLink`, `externalUser`, `externalUsers`, `inboxNotifications`, `initiativeFilterSuggestion`, `initiativeLabel`, `initiativeLabels`, `integration`, `integrationHasScopes`, `integrationTemplate`, `integrationTemplates`, `integrations`, `integrationsSettings`, `issueFigmaFileKeySearch`, `issueFilterSuggestion`, `issueImportCheckSync`, `issueImportJqlCheck`, `issuePriorityValues`, `issueRepositorySuggestions`, `issueSearch`, `issueTitleSuggestionFromCustomerRequest`, `issueVcsBranchSearch`, `jiraProject`, `jiraProjects`, `notificationSubscription`, `notificationSubscriptions`, `oauthApplication`, `oauthApplicationCodingSessionTrustedSource`, `oauthApplications`, `organizationExists`, `projectFilterSuggestion`, `pushSubscriptionTest`, `quotas`, `rateLimitStatus`, `roadmap`, `roadmapToProject`, `roadmapToProjects`, `roadmaps`, `searchDocuments`, `searchProjects`, `semanticSearch`, `slaConfigurations`, `ssoUrlFromEmail`, `templatesForIntegration`, `timeSchedule`, `timeSchedules`, `triageResponsibilities`, `triageResponsibility`, `usageAlert`, `usageAlerts`, `userSessions`, `verifyGitHubEnterpriseServerInstallation`

</details>

<details>
<summary>Mutations not implemented (170)</summary>

`agentSkillCreate`, `agentSkillDelete`, `agentSkillUpdate`, `airbyteIntegrationConnect`, `attachmentLinkDiscord`, `attachmentLinkFront`, `attachmentLinkGitHubIssue`, `attachmentLinkGitHubPR`, `attachmentLinkGitLabMR`, `attachmentLinkIntercom`, `attachmentLinkJiraIssue`, `attachmentLinkSalesforce`, `attachmentLinkSlack`, `attachmentLinkZendesk`, `attachmentSyncToSlack`, `contactCreate`, `createCsvExportReport`, `createInitiativeUpdateReminder`, `createProjectUpdateReminder`, `customerNeedCreateFromAttachment`, `cycleShiftAll`, `cycleStartUpcomingCycleToday`, `documentUpdateWorkspaceAccess`, `emailIntakeAddressCreate`, `emailIntakeAddressDelete`, `emailIntakeAddressRefreshSesDomainStatus`, `emailIntakeAddressRotate`, `emailIntakeAddressUpdate`, `emailTokenUserAccountAuth`, `emailUnsubscribe`, `emailUserAccountAuthChallenge`, `emojiCreate`, `emojiDelete`, `entityExternalLinkCreate`, `entityExternalLinkDelete`, `entityExternalLinkUpdate`, `fileUploadDangerouslyDelete`, `gitAutomationStateCreate`, `gitAutomationStateDelete`, `gitAutomationStateUpdate`, `gitAutomationTargetBranchCreate`, `gitAutomationTargetBranchDelete`, `gitAutomationTargetBranchUpdate`, `googleUserAccountAuth`, `imageUploadFromUrl`, `importFileUpload`, `inboxNotificationUpdate`, `initiativeAddLabel`, `initiativeLabelCreate`, `initiativeLabelDelete`, `initiativeLabelRestore`, `initiativeLabelRetire`, `initiativeLabelUpdate`, `initiativeRemoveLabel`, `integrationArchive`, `integrationAsksConnectChannel`, `integrationDelete`, `integrationDiscord`, `integrationFigma`, `integrationFront`, `integrationGitHubEnterpriseServerConnect`, `integrationGitHubPersonal`, `integrationGithubCommitCreate`, `integrationGithubConnect`, `integrationGithubRemoveCodeAccess`, `integrationGitlabConnect`, `integrationGitlabRotate`, `integrationGitlabTestConnection`, `integrationGitlabUpdateRotationSettings`, `integrationGitlabUpdateToken`, `integrationGong`, `integrationGoogleSheets`, `integrationIntercom`, `integrationIntercomDelete`, `integrationIntercomSettingsUpdate`, `integrationJiraPersonal`, `integrationLoom`, `integrationMicrosoftPersonalConnect`, `integrationMicrosoftTeams`, `integrationRequest`, `integrationSalesforce`, `integrationSentryConnect`, `integrationSlack`, `integrationSlackAsks`, `integrationSlackCustomViewNotifications`, `integrationSlackCustomerChannelLink`, `integrationSlackImportEmojis`, `integrationSlackOrAsksUpdateSlackTeamName`, `integrationSlackOrgProjectUpdatesPost`, `integrationSlackPersonal`, `integrationSlackPost`, `integrationSlackProjectPost`, `integrationTemplateCreate`, `integrationTemplateDelete`, `integrationZendesk`, `integrationsSettingsCreate`, `integrationsSettingsUpdate`, `issueBatchCreate`, `issueExternalSyncDisable`, `issueImportCreateAsana`, `issueImportCreateClubhouse`, `issueImportCreateJira`, `issueImportDelete`, `issueReminder`, `issueShare`, `issueUnshare`, `jiraProjectBatchMigrate`, `logout`, `logoutAllSessions`, `logoutOtherSessions`, `logoutSession`, `notificationCategoryChannelSubscriptionUpdate`, `notificationSubscriptionCreate`, `notificationSubscriptionDelete`, `notificationSubscriptionUpdate`, `oauthApplicationArchive`, `oauthApplicationCreate`, `oauthApplicationRotateSecret`, `oauthApplicationRotateWebhookSecret`, `oauthApplicationUpdate`, `organizationCancelDelete`, `organizationDelete`, `organizationDeleteChallenge`, `organizationDomainDelete`, `organizationInviteUpdate`, `organizationStartTrial`, `organizationStartTrialForPlan`, `projectAddLabel`, `projectExternalSyncDisable`, `projectLabelRestore`, `projectLabelRetire`, `projectMilestoneMove`, `projectRemoveLabel`, `projectStatusArchive`, `projectStatusCreate`, `projectStatusUnarchive`, `projectStatusUpdate`, `pushSubscriptionCreate`, `pushSubscriptionDelete`, `refreshGoogleSheetsData`, `resendOrganizationInvite`, `resendOrganizationInviteByEmail`, `roadmapArchive`, `roadmapCreate`, `roadmapDelete`, `roadmapToProjectCreate`, `roadmapToProjectDelete`, `roadmapToProjectUpdate`, `roadmapUnarchive`, `roadmapUpdate`, `samlTokenUserAccountAuth`, `teamCyclesDelete`, `teamKeyDelete`, `teamUnarchive`, `timeScheduleCreate`, `timeScheduleDelete`, `timeScheduleRefreshIntegrationSchedule`, `timeScheduleUpdate`, `timeScheduleUpsertExternal`, `trackAnonymousEvent`, `triageResponsibilityCreate`, `triageResponsibilityDelete`, `triageResponsibilityUpdate`, `userDiscordConnect`, `userExternalUserDisconnect`, `userFlagUpdate`, `userRevokeAllSessions`, `userRevokeSession`, `userSettingsFlagsReset`, `userUnlinkFromIdentityProvider`

</details>

