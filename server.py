"""
OpsOrchestrator FastAPI backend.

Run:
    python server.py
"""

from __future__ import annotations

import asyncio
import json
import os
import uuid
from dataclasses import asdict
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
from fastapi import Body, FastAPI, File, Form, Header, UploadFile
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from agents_pipeline import OpsResult, finalize_work_item, run_pipeline

load_dotenv()

ROOT = Path(__file__).parent
WEB_DIR = ROOT / "web"
TICKETS_DIR = ROOT / "synthetic_data" / "tickets"
MAX_FILE_MB = 5
MAX_FILES = 6

app = FastAPI(title="OpsOrchestrator")
JOBS: dict[str, asyncio.Queue] = {}


def _example_path(name: str) -> Optional[Path]:
    safe = Path(name.strip()).name
    if not safe:
        return None
    if not safe.endswith(".txt"):
        safe += ".txt"
    candidate = (TICKETS_DIR / safe).resolve()
    try:
        if candidate.parent == TICKETS_DIR.resolve() and candidate.exists():
            return candidate
    except OSError:
        return None
    return None


def _friendly_error(e: Exception) -> str:
    msg = str(e)
    low = msg.lower()
    if "api key" in low or "api_key" in low:
        return "OpenAI API key missing or rejected. Check OPENAI_API_KEY in .env."
    if "rate limit" in low or "quota" in low:
        return "OpenAI rate limit or quota reached."
    if "timeout" in low or "connection" in low:
        return "Could not reach OpenAI. Check network and retry."
    return f"{type(e).__name__}: {msg}"


def serialize(result: OpsResult) -> dict:
    return {
        "intake": result.intake.model_dump(),
        "policy": result.policy.model_dump(),
        "resolution": result.resolution.model_dump(),
        "sop": result.sop.model_dump(),
        "audit_log": [asdict(e) for e in result.audit_log],
    }


def apply_key(key) -> None:
    if key:
        os.environ["OPENAI_API_KEY"] = key
        try:
            from agents import set_default_openai_key
            set_default_openai_key(key)
        except Exception:
            pass


async def run_job(job_id: str, text: str, example_texts: list[tuple[str, str]], files: list[tuple[str, bytes]], key=None) -> None:
    q = JOBS[job_id]
    apply_key(key)

    def emit(etype: str, **kw) -> None:
        q.put_nowait({"type": etype, **kw})

    try:
        blocks = []
        if text.strip():
            blocks.append(("Pasted text", text.strip()))
            emit("evidence", name="Pasted text", kind="text")
        for name, etext in example_texts:
            blocks.append((name, etext))
            emit("evidence", name=name, kind="example ticket")
        for name, data in files[:MAX_FILES]:
            if not data:
                continue
            if len(data) > MAX_FILE_MB * 1024 * 1024:
                emit("note", message=f"Skipped {name}: over {MAX_FILE_MB} MB")
                continue
            try:
                content = data.decode("utf-8", errors="ignore").strip()
            except Exception:  # noqa: BLE001
                emit("note", message=f"Skipped {name}: unreadable")
                continue
            if content:
                blocks.append((name, content))
                emit("evidence", name=name, kind="uploaded text")

        dossier = "\n\n".join(f"=== TICKET: {name} ===\n{body}" for name, body in blocks)
        if not dossier.strip():
            emit("error", message="No readable ticket found.")
            return

        def on_progress(agent: str, status: str) -> None:
            q.put_nowait({"type": "progress", "agent": agent, "status": status})

        result = await run_pipeline(dossier, on_progress=on_progress)
        emit("result", data=serialize(result), dossier=dossier)
    except Exception as e:  # noqa: BLE001
        emit("error", message=_friendly_error(e))
    finally:
        q.put_nowait(None)


@app.get("/api/examples")
async def list_examples() -> JSONResponse:
    return JSONResponse(sorted(p.stem for p in TICKETS_DIR.glob("*.txt")))


@app.get("/api/example/{name}")
async def get_example(name: str) -> JSONResponse:
    path = _example_path(name)
    if not path:
        return JSONResponse({"error": "not found"}, status_code=404)
    return JSONResponse({"name": path.stem, "text": path.read_text(encoding="utf-8")})


@app.post("/api/process")
async def process(
    text: str = Form(""),
    examples: str = Form(""),
    files: list[UploadFile] = File(default=[]),
    x_openai_key: str = Header(None),
) -> JSONResponse:
    example_texts: list[tuple[str, str]] = []
    for name in [e for e in examples.split(",") if e.strip()]:
        path = _example_path(name)
        if path:
            example_texts.append((path.stem, path.read_text(encoding="utf-8")))

    file_blobs = [(f.filename, await f.read()) for f in files if f.filename]
    job_id = uuid.uuid4().hex
    JOBS[job_id] = asyncio.Queue()
    asyncio.create_task(run_job(job_id, text, example_texts, file_blobs, key=x_openai_key))
    return JSONResponse({"job_id": job_id})


@app.get("/api/events/{job_id}")
async def events(job_id: str) -> StreamingResponse:
    async def stream():
        q = JOBS.get(job_id)
        if q is None:
            yield f"data: {json.dumps({'type': 'error', 'message': 'unknown job'})}\n\n"
            return
        try:
            while True:
                item = await q.get()
                if item is None:
                    break
                yield f"data: {json.dumps(item)}\n\n"
        finally:
            JOBS.pop(job_id, None)

    return StreamingResponse(stream(), media_type="text/event-stream")


@app.post("/api/finalize")
async def finalize(payload: dict = Body(...), x_openai_key: str = Header(None)) -> JSONResponse:
    apply_key(x_openai_key)
    try:
        result = await finalize_work_item(
            payload.get("intake") or {},
            payload.get("policy") or {},
            payload.get("resolution") or {},
            (payload.get("decision") or "approved").lower(),
            payload.get("note") or "",
        )
        return JSONResponse(result.model_dump())
    except Exception as e:  # noqa: BLE001
        return JSONResponse({"error": _friendly_error(e)}, status_code=200)


@app.get("/api/health")
async def health() -> JSONResponse:
    return JSONResponse({"openai_key": bool(os.getenv("OPENAI_API_KEY"))})


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(WEB_DIR / "index.html")


app.mount("/static", StaticFiles(directory=WEB_DIR), name="static")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("server:app", host="127.0.0.1", port=8010, reload=False)
