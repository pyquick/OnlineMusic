## [ERR-20261001-DEPLOY] transient-healthcheck-reset

**Logged**: 2026-10-01T00:00:00Z
**Priority**: low
**Status**: resolved
**Area**: infra

### Summary
The first HTTP check immediately after container recreation saw a connection reset while the container was still starting.

### Error
```text
curl: (56) Recv failure: Connection reset by peer
```

### Context
- `./build.sh` completed and recreated the production container.
- Container logs then showed Next.js ready; a retry succeeded.

### Suggested Fix
Retry the health check after container readiness before treating deployment as failed.

### Metadata
- Reproducible: unknown
- Related Files: build.sh
- Pattern-Key: net.transient-startup
- Recurrence-Count: 1

### Resolution
- **Resolved**: 2026-10-01T00:00:00Z
- **Notes**: Container remained healthy and the retried HTTP check returned successfully.

---

**Logged**: 2026-10-01T00:00:00Z
**Priority**: low
**Status**: resolved
**Area**: vcs

### Summary
The expected post-deploy UI changes were already included in the existing commit, so the follow-up commit had no tracked changes.

### Error
```text
nothing added to commit but untracked files present (.learnings/)
```

### Context
- Attempted to commit the final profile-divider and glass-control changes.
- `git status` showed only the local `.learnings/` directory; the three UI files were clean.

### Suggested Fix
Do not create an empty commit. Keep `.learnings/` local and untracked.

### Metadata
- Reproducible: no
- Related Files: app/globals.css, app/page.tsx, features/now-playing/NowPlayingView.tsx
- Pattern-Key: vcs.commit-no-changes
- Recurrence-Count: 1

### Resolution
- **Resolved**: 2026-10-01T00:00:00Z
- **Notes**: Verified the deployed UI changes are already contained in commit 93a23cb.

---
