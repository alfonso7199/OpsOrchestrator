# OpsOrchestrator

**From back-office tickets to policy-compliant action plans.**

OpsOrchestrator is an agentic assistant for enterprise operations (IT, HR, Finance, Legal). It
takes an internal ticket, classifies it, checks the request against internal policy **with cited
clauses**, drafts a resolution and the system actions, writes a reusable SOP snippet, and keeps a
human reviewer in the loop before anything executes. Built with the **OpenAI Agents SDK** for the
HCLTech–OpenAI Agentic AI Hackathon (Track 2 — Enterprise Operations; based on HCL Top-15 case
#4, Banking Middle & Back Office Operations).

## The problem

Shared-services and back-office teams drown in repetitive tickets: access requests, vendor
exceptions, certificate requests, contract reviews. Each one means reading the request, finding
the right policy, checking controls and drafting a response — slow, inconsistent, and hard to
audit.

## What it does

- **Classifies** the ticket: department, category, urgency, entities and missing fields.
- **Checks policy** against synthetic internal controls and quotes the exact clause that applies.
- **Drafts the resolution**: employee-facing response, concrete system actions and required
  approvers, with a routing decision and confidence.
- **Generates a reusable SOP** from the resolved item, so the process documents itself.
- **Human in the loop**: approve, reject, **override the route** and add a note; approval triggers
  the downstream action. A guardrail forces review when confidence is low or controls are missing.

## How it works

```
ticket / email
   └─ Evidence intake → ClassifierAgent → PolicyAgent → ResolutionAgent → SOPAgent → Manager
                         (dept, gaps)     (controls +    (route, reply,    (reusable   (work item +
                                           citations)     actions)          procedure)  audit log)
                                                                                │
                                                                                └─► HUMAN: approve /
                                                                                    reject / override
```

## Tech stack

- **Backend**: Python, FastAPI, OpenAI Agents SDK; live agent trace over Server-Sent Events.
- **Frontend**: custom single-page UI (HTML/CSS/JS, no build step).

## Project structure

```
agents_pipeline.py   the agents, models and finalize logic
server.py            FastAPI app (process, events/SSE, finalize)
web/                 index.html · style.css · app.js
synthetic_data/      tickets/ (4 sample tickets) · policies/ (internal policies)
```

## Getting started

You need an **OpenAI API key** (platform.openai.com — pay-as-you-go). A run costs a few cents.

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env       # set OPENAI_API_KEY
python server.py
```

Open http://127.0.0.1:8010.

## Using it

1. Pick a sample ticket from the demo queue (IT access, finance vendor exception, HR certificate
   with missing info, legal contract review) — or paste your own.
2. Press **Run agent workflow** and watch the trace: classify → policy → resolution → SOP.
3. Review the decision file: ticket intake, policy check with cited clauses, the drafted
   resolution and the auto-generated SOP.
4. **Approve / Reject**, optionally **override the route** and add a reviewer note. Everything is
   captured in the audit trail and the JSON export.

## Bring your own API key

No key in your `.env`? Click **Add API key** in the top bar and paste your own OpenAI key. It is
stored only in your browser (localStorage) and sent to your local server with each request; the
server falls back to its `.env` key if none is set. Never commit your key to the repo.

## Notes

All tickets, policies and employee data are **synthetic**. OpsOrchestrator prepares and explains;
a human approves before any action is taken.
