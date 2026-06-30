# OpsOrchestrator — Submission & video script

## Submission form answers (copy/paste)

**Agent workflow.** OpsOrchestrator turns a back-office ticket into a policy-compliant action
plan. (1) **ClassifierAgent** reads the ticket and extracts department, urgency, entities and
missing fields. (2) **PolicyAgent** checks the request against internal controls and quotes the
exact policy clause that applies. (3) **ResolutionAgent** drafts the employee-facing response,
the concrete system actions and the required approvers, with a routing decision and confidence.
(4) **SOPAgent** generates a reusable standard-operating-procedure snippet from the resolved
item. (5) A **Manager** assembles the work item and audit log. A human approves, rejects or
overrides the route; an **Action agent** produces the downstream action. A guardrail forces
review when confidence is low or controls are missing.

**OpenAI technology stack.** OpenAI **Agents SDK** (Agent + Runner) with **structured outputs**
(Pydantic `output_type`) on the Responses API; live multi-agent trace streamed over SSE. Models:
GPT-4o class. Built with **Codex**.

---

## Video script (target 4–5 min)

### Part 1 — Pitch deck (~90 seconds)

- **[Slide 1 — Title]** "Hi, I'm ⟨name⟩. This is **OpsOrchestrator** — from back-office tickets to
  policy-compliant action plans. Built with the OpenAI Agents SDK and Codex, for Track 2,
  enterprise operations."
- **[Slide 2 — Problem]** "Shared-services teams drown in repetitive tickets: access requests,
  vendor exceptions, certificates, contract reviews. Each one means reading it, finding the
  policy, checking controls and drafting a reply — slow, inconsistent, hard to audit."
- **[Slide 3 — How it works]** "Here's the **agent workflow**: ClassifierAgent triages the ticket,
  PolicyAgent checks the internal controls and **cites the clause**, ResolutionAgent drafts the
  reply and system actions, and SOPAgent writes a reusable procedure — so the process documents
  itself. A human approves, with a guardrail on low confidence."
- **[Slide 4 — What the judges see]** "You'll see a ticket classified and checked, the cited
  policy, the drafted resolution, and the auto-generated SOP."
- **[Slide 5 — Impact & scale]** "Minutes instead of hours, every decision tied to a control, and
  SOPs that build themselves. It scales to any internal queue — IT, HR, Finance, Legal,
  procurement."

### Part 2 — Live demo (~3 minutes)

1. "I open OpsOrchestrator at **localhost:8010**."
2. "First the key: I click **Add API key**, paste my own OpenAI key — so anyone can run the repo.
   The dot turns green."
3. "I pick the sample **finance vendor exception** ticket from the demo queue — no typing."
4. "I click **Run agent workflow** and watch the trace: **classify → policy → resolution → SOP**,
   each step streamed live."
5. "Here's the decision file. The **policy check quotes the exact internal control**, and the
   resolution lists the employee reply, the system actions and the approvers — with a route and a
   confidence score."
6. "Down here is the **reusable SOP** the agent generated from this ticket. I can **override the
   route** and add a reviewer note, then **Approve** — and it's all in the audit trail."
7. "Let me also open the **HR certificate** ticket, which is missing info, to show the guardrail
   asking for review. That's OpsOrchestrator — back-office work, on rails."
