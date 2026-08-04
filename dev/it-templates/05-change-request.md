# Change request — GA PDF Editor

**CR ID:** [auto / ticket #]  
**Requested by:** [name]  
**Date:** [YYYY-MM-DD]  
**Desired window:** [date/time + timezone]

---

## Summary

Deploy / update **GA PDF Editor** version **[x.y.z]** for **[scope: pilot OU / all staff / lab]**.

## Business reason

[e.g. Offline PDF annotation and fillable form design without cloud upload; replace ad-hoc tools.]

## Change type

- [ ] New install  
- [ ] Version upgrade  
- [ ] Config-only change  
- [ ] Rollback  
- [ ] Decommission  

## Scope

| Item | Detail |
|------|--------|
| Devices / users | |
| Install path or URL | |
| Package (slim/full) | |
| SVC port | [17880 / other] |
| Start-on-boot | [Yes/No] |
| PWA encouraged | [Yes/No] |

## Impact

| Area | Impact |
|------|--------|
| User downtime | [None / minutes / …] |
| Network | [Setup download once / none] |
| Security | See attached brief / ticket link |
| Other apps | [Port conflicts? AV?] |

## Plan

1. [ ] Backup previous install folder to **[path]**  
2. [ ] Deploy package / update files  
3. [ ] Start SVC (if used); verify `.url`  
4. [ ] Smoke test (open → annotate → project save → PDF export)  
5. [ ] Communicate to users (link to short how-to)

## Rollback

1. Stop SVC  
2. Restore **[backup path]**  
3. Restart SVC; verify version string in `VERSION` / title bar  

**Rollback owner:** [name]  
**Rollback time estimate:** [minutes]

## Test evidence

| Test | Pass? | Notes |
|------|-------|-------|
| Open PDF | | |
| Edit + undo | | |
| Save project | | |
| Export PDF | | |
| Forms (if used) | | |

## Approvals

| Role | Name | Date | Sign-off |
|------|------|------|----------|
| Requester | | | |
| IT owner | | | |
| Security (if required) | | | |
| CAB | | | |

## Post-implementation

- [ ] Ticket updated with version + path  
- [ ] Support runbook version field updated  
- [ ] Issues found:  

**Close notes:**
