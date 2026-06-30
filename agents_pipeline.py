"""
OpsOrchestrator - multi-agent pipeline for enterprise operations tickets.

Flow: Classify -> Policy check -> Resolution draft -> SOP update, with a human
review step before downstream action. Data is synthetic.
"""

from __future__ import annotations

import asyncio
import json
import os
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Callable, Optional

from dotenv import load_dotenv
from pydantic import BaseModel, Field

from agents import Agent, Runner

load_dotenv()

ROOT = Path(__file__).parent
POLICIES_DIR = ROOT / "synthetic_data" / "policies"
MODEL = os.getenv("OPSORCH_MODEL", "gpt-4o")
CONFIDENCE_THRESHOLD = 0.72


class TicketIntake(BaseModel):
    ticket_id: Optional[str] = None
    requester_name: Optional[str] = None
    requester_email: Optional[str] = None
    department: str = Field(description="IT | HR | Finance | Legal | Procurement | Operations")
    category: str
    urgency: str = Field(description="low | normal | high | critical")
    summary: str
    requested_action: str
    entities: list[str] = Field(default_factory=list)
    missing_fields: list[str] = Field(default_factory=list)
    risk_flags: list[str] = Field(default_factory=list)


class PolicyCitation(BaseModel):
    clause: str
    quote: str


class PolicyCheck(BaseModel):
    applicable_policy: str
    allowed_action: bool
    clause_citations: list[PolicyCitation] = Field(default_factory=list)
    controls_required: list[str] = Field(default_factory=list)
    missing_controls: list[str] = Field(default_factory=list)
    reasoning: str


class ResolutionDraft(BaseModel):
    route: str = Field(description="auto_resolve | human_approval | escalate | pending_information")
    confidence: float = Field(ge=0.0, le=1.0)
    action_summary: str
    employee_response: str
    system_actions: list[str] = Field(default_factory=list)
    approvers: list[str] = Field(default_factory=list)
    requires_human_review: bool = False


class SOPDraft(BaseModel):
    title: str
    trigger: str
    steps: list[str] = Field(default_factory=list)
    controls: list[str] = Field(default_factory=list)


@dataclass
class AuditEntry:
    timestamp: str
    agent: str
    summary: str


@dataclass
class OpsResult:
    intake: TicketIntake
    policy: PolicyCheck
    resolution: ResolutionDraft
    sop: SOPDraft
    audit_log: list[AuditEntry] = field(default_factory=list)


class Finalization(BaseModel):
    decision: str = Field(description="approved | rejected")
    action: str = Field(description="ticket_resolved | approval_requested | escalated | request_info")
    action_summary: str
    employee_message: str
    next_steps: list[str] = Field(default_factory=list)


def _now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def load_policy_pack() -> str:
    blocks = []
    for path in sorted(POLICIES_DIR.glob("*.txt")):
        blocks.append(f"=== POLICY: {path.name} ===\n{path.read_text(encoding='utf-8')}")
    return "\n\n".join(blocks)


def build_classifier_agent() -> Agent:
    return Agent(
        name="ClassifierAgent",
        model=MODEL,
        instructions=(
            "You classify enterprise operations tickets. Extract requester, "
            "department, category, urgency, requested action, entities and missing "
            "fields. Essential fields depend on the category: IT access needs "
            "manager, cost center, target system and role; Finance invoice "
            "exceptions need PO, invoice amount, PO amount, vendor and owner; HR "
            "certificates need purpose, employee identity, salary consent if salary "
            "is requested, and language if needed; Legal reviews need counterparty, "
            "sponsor, document type, deadline and unusual clauses. Do not invent."
        ),
        output_type=TicketIntake,
    )


def build_policy_agent() -> Agent:
    return Agent(
        name="PolicyAgent",
        model=MODEL,
        instructions=(
            "You check the ticket against the provided internal policy pack. Quote "
            "verbatim the clauses that support your answer. Decide whether the "
            "requested action is allowed now, which controls are required, and what "
            "controls or information are missing. Never cite a clause that is not in "
            "the policy pack."
        ),
        output_type=PolicyCheck,
    )


def build_resolution_agent() -> Agent:
    return Agent(
        name="ResolutionAgent",
        model=MODEL,
        instructions=(
            "You draft the operational resolution. Routes: auto_resolve when policy "
            "allows immediate fulfillment and confidence is high; human_approval "
            "when approval is required; escalate when specialist/legal/security/"
            "finance controller review is required; pending_information when "
            "essential data is missing. Include employee-facing response, concrete "
            "system actions and approvers. If confidence is below "
            f"{CONFIDENCE_THRESHOLD} or route is not auto_resolve, set "
            "requires_human_review=true. Do not invent named systems that are not "
            "present in the ticket or policy; say 'ticketing queue' or 'work queue' "
            "instead. Do not mention HR systems unless the ticket is an HR ticket."
        ),
        output_type=ResolutionDraft,
    )


def build_sop_agent() -> Agent:
    return Agent(
        name="SOPAgent",
        model=MODEL,
        instructions=(
            "Create a short SOP snippet from the ticket, policy controls and draft "
            "resolution. Keep it general enough to reuse on similar future tickets."
        ),
        output_type=SOPDraft,
    )


async def run_pipeline(
    ticket_text: str,
    on_progress: Optional[Callable[[str, str], None]] = None,
) -> OpsResult:
    def notify(agent: str, status: str) -> None:
        if on_progress:
            on_progress(agent, status)

    audit: list[AuditEntry] = []
    policy_pack = load_policy_pack()

    notify("ClassifierAgent", "Classifying ticket and extracting controls...")
    intake_res = await Runner.run(build_classifier_agent(), input=ticket_text)
    intake: TicketIntake = intake_res.final_output
    audit.append(
        AuditEntry(
            _now(),
            "ClassifierAgent",
            f"department={intake.department}; category={intake.category}; "
            f"urgency={intake.urgency}; missing={intake.missing_fields or 'none'}",
        )
    )

    notify("PolicyAgent", "Checking internal policies with citations...")
    policy_input = (
        f"POLICY PACK:\n{policy_pack}\n\n"
        f"TICKET INTAKE:\n{intake.model_dump_json(indent=2)}\n\n"
        f"RAW TICKET:\n{ticket_text}"
    )
    policy_res = await Runner.run(build_policy_agent(), input=policy_input)
    policy: PolicyCheck = policy_res.final_output
    audit.append(
        AuditEntry(
            _now(),
            "PolicyAgent",
            f"allowed={policy.allowed_action}; cited={len(policy.clause_citations)}; "
            f"missing_controls={policy.missing_controls or 'none'}",
        )
    )

    notify("ResolutionAgent", "Drafting resolution and approval route...")
    resolution_input = (
        f"INTAKE:\n{intake.model_dump_json(indent=2)}\n\n"
        f"POLICY CHECK:\n{policy.model_dump_json(indent=2)}"
    )
    resolution_res = await Runner.run(build_resolution_agent(), input=resolution_input)
    resolution: ResolutionDraft = resolution_res.final_output
    if resolution.confidence < CONFIDENCE_THRESHOLD:
        resolution.requires_human_review = True
    audit.append(
        AuditEntry(
            _now(),
            "ResolutionAgent",
            f"route={resolution.route}; confidence={resolution.confidence:.2f}; "
            f"human_review={resolution.requires_human_review}",
        )
    )

    notify("SOPAgent", "Generating reusable SOP snippet...")
    sop_input = (
        f"INTAKE:\n{intake.model_dump_json(indent=2)}\n\n"
        f"POLICY CHECK:\n{policy.model_dump_json(indent=2)}\n\n"
        f"RESOLUTION:\n{resolution.model_dump_json(indent=2)}"
    )
    sop_res = await Runner.run(build_sop_agent(), input=sop_input)
    sop: SOPDraft = sop_res.final_output
    audit.append(AuditEntry(_now(), "SOPAgent", f"SOP drafted: {sop.title}"))

    notify("Manager", "Work item ready for human review.")
    return OpsResult(intake, policy, resolution, sop, audit)


async def finalize_work_item(
    intake: dict,
    policy: dict,
    resolution: dict,
    decision: str,
    reviewer_note: str = "",
) -> Finalization:
    agent = Agent(
        name="ActionAgent",
        model=MODEL,
        instructions=(
            "A human reviewer has approved or rejected an enterprise operations "
            "work item. Produce the concrete downstream action and employee message. "
            "If approved and route is auto_resolve, action=ticket_resolved. If "
            "approved and approvals are required, action=approval_requested. If "
            "approved and route is escalate, action=escalated. If route is "
            "pending_information or decision is rejected because data is missing, "
            "action=request_info. Never claim an action was completed when policy "
            "requires approval first. Sign as OpsOrchestrator Service Desk."
        ),
        output_type=Finalization,
    )
    note = f"\n\nREVIEWER NOTE:\n{reviewer_note}" if reviewer_note.strip() else ""
    prompt = (
        f"DECISION: {decision}\n\n"
        f"INTAKE:\n{json.dumps(intake, ensure_ascii=False)}\n\n"
        f"POLICY:\n{json.dumps(policy, ensure_ascii=False)}\n\n"
        f"RESOLUTION:\n{json.dumps(resolution, ensure_ascii=False)}"
        f"{note}"
    )
    res = await Runner.run(agent, input=prompt)
    return res.final_output


def run_pipeline_sync(ticket_text: str) -> OpsResult:
    return asyncio.run(run_pipeline(ticket_text))
