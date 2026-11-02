# Security audit — partial source review

Status: **incomplete**. Reviewed commit dedb29e9c2efedfde63a9816f5e01c427c517f3c plus the existing uncommitted working tree. Scope included frontend, backend, authentication, authorization, API and database access, judge, and deployment configuration. No application code was changed. No prior compatible audit was identified.

## Confirmed vulnerabilities

None were confirmed by a bounded runtime demonstration. This is not a security clearance. The required isolated execution environment was unavailable, so application tests, builds, browser tests, network requests and deployment probes were not run. The mandatory independent candidate and final-record verification phases and coverage critic passes remain incomplete. The skill's command-line report validators also cannot run safely on this Windows runtime because their no-follow/nonblocking file-open protection is unavailable. These limitations mean this report is a partial handoff, not a completed security-audit workflow.

## Source-grounded leads requiring validation

These are hypotheses, not confirmed vulnerabilities or severity ratings. Suggested order reflects potential impact and ease of review, not a validated risk score.

1. **Authentication over HTTP in the server setup.** SETUP_SERVER.md:192 directs initial administrator login over HTTP; compose.yml:101 publishes web port 80 and SETUP_SERVER.md:249 describes restricting direct access after HTTPS setup as optional. If that route is reachable across an untrusted network, credentials and session tokens could be intercepted. Verify the effective firewall, bind address and TLS routing without submitting real credentials. Require TLS or a private tunnel before first login and restrict direct HTTP to the trusted proxy.

2. **Old password-reset tokens after password change.** AuthService.java:70-77 changes a password and revokes refresh tokens but does not update reset tokens; AuthService.java:115-120 accepts a still-unused, unexpired reset token. A holder of an existing recovery token could potentially reset the password after the owner changes it. In an isolated dummy-account fixture, issue a reset token, change the password, then check whether the earlier token still works. Invalidate outstanding reset tokens transactionally when the password changes or resets.

3. **Sessions created concurrently with revocation.** AuthService.java:57-65 reads and verifies a password without locking the user while changePassword revokes existing refresh rows; an in-flight login may issue a new session after the change. Similarly, AuthService.java:87-103 rotates refresh tokens while logout updates the existing family rows, potentially leaving a newly inserted child unrevoked. Confirm each using deterministic two-transaction dummy fixtures. Bind login issuance to a credential version or shared user lock, and synchronize refresh/logout on durable family state.

4. **Archived practice problems may be made visible again.** LaboratoryService.java:189-217 archives a problem and hides its publication, while PracticeService.java:68-83 permits an organizer to change publication visibility without an apparent archived-parent check. Participant catalog and practice submission paths check visibility. Test with a dummy owner, unrelated organizer and participant to determine whether the archived statement can be exposed again. Reject unhide for archived parents and enforce the archived-state condition in catalog and admission queries; retain historical records as intended.

5. **Private browser drafts can persist across account changes.** ProblemWizard.tsx:12-34 stores hidden tests and reference code in the fixed localStorage key cp.problem-wizard. api.ts:23,123 clears the session on logout; the authoring and submission draft keys appear account-independent. If two users share a browser profile, a later user may see an earlier user's unfinished draft. Check with two dummy accounts in one isolated browser profile. Scope drafts to the authenticated user, reject owner mismatches, and clear sensitive drafts on logout or account change.

6. **Forwarded client address trust depends on deployment topology.** frontend/nginx.conf:13-17 trusts RFC1918 peers as proxies, and AuthController.java:35 uses the client address for recovery rate limits. If an untrusted peer reaches nginx from a trusted private range and forwarding is honored, it may choose rate-limit identities. Confirm actual peer and NAT topology and test address attribution only in an isolated dummy proxy fixture. Trust only explicit ingress addresses, sanitize forwarded headers, and block alternate direct paths.

7. **Invite rotation concurrency.** TeamController.java:27-40 resolves a team invitation before acquiring the team lock, while rotation deletes prior invitations under that lock. A join already in flight may proceed after rotation without rechecking the old code. Confirm the intended replacement semantics and reproduce with deterministic dummy transactions. Revalidate the invite and expiry after obtaining the team lock if rotation must revoke waiting joins.

8. **Judge cleanup between test cases.** judge/runner.py resets /tmp with shell globs that omit names beginning with two dots; a submission may be able to retain such files between test cases in the same job. Validate whether independent case execution is a security invariant and whether this changes acceptance in a bounded isolated fixture. Use reliable complete cleanup or fresh isolation per test. This does not establish a host escape or access across submissions.

## Positive source patterns and additional checks

The reviewed code uses randomly generated tokens stored as digests, checks account/session state when processing bearer credentials, applies scoped permission checks in many resource paths, uses parameterized JDBC queries in reviewed paths, and includes database guards for sealed versions and contest snapshots. The judge configuration includes containment controls. These observations do not prove that those controls are complete or correctly deployed. Consider separate migration and runtime database accounts, narrow proxy trust, release input pinning, and account-specific draft cleanup as defense in depth.

## Coverage and limitations

The initial plan contains 55 source-review units across the requested components. The research results have not been consolidated into a final validated ledger, no clean coverage-critic pass was completed, and the leads above have not received the independent verification required by the security-audit skill. Source review cannot establish actual deployed TLS, firewall rules, database grants, proxy attachment, dependency advisories, or runtime race outcomes. Re-run the remaining verification in a fully isolated environment with dummy accounts and no access to live services. Do not interpret the absence of confirmed findings as proof of safety.
