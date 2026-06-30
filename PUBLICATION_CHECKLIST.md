# OpsOrchestrator Publication Checklist

## Current Verdict

OpsOrchestrator is a good second project because it covers Track 2 while
ClaimPilot covers Track 1. It reuses the same winning pattern: document intake,
multi-agent orchestration, policy citations, audit trail and human review.

## Must Validate

- Server starts on `http://127.0.0.1:8010`.
- `python scripts/demo_smoke.py` passes.
- At least three examples run end-to-end with OpenAI:
  - IT access request -> standard approval or auto-resolve.
  - Finance exception -> human approval / controller route.
  - HR certificate -> pending information.
- Finalize endpoint produces a downstream action without pretending approvals
  were skipped.

## Recommended Demo Script

1. Run `01_it_access_request` and show the agent trace.
2. Point to the cited IT policy clauses.
3. Approve and show the downstream employee message.
4. Run `02_finance_vendor_exception` to show control enforcement.
5. Run `03_hr_certificate_missing_info` to show the trap case.

## Pitch Angle

"Back-office teams lose time reading tickets, searching policies and deciding who
must approve what. OpsOrchestrator turns every ticket into a cited, auditable
action plan in under a minute, with human control before execution."
