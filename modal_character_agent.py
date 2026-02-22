"""
modal_character_agent.py
Character AI Agent System — LangGraph + Multi-LLM + Skill Evolution
Deployed on Modal.com as a FastAPI web endpoint.

Endpoints:
  GET  /health         — health check
  POST /chat           — single character responds to a message
  POST /conversation   — N-character LangGraph multi-agent discussion
  POST /reflect        — LangGraph skill evolution (analyze history → update profile)
"""

from __future__ import annotations

import modal

# ── Modal image ────────────────────────────────────────────────────────────────
image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "fastapi[standard]",
        "uvicorn",
        "pydantic>=2.0",
        "supabase",
        "langgraph>=0.2",
        "langchain-core>=0.2",
        "langchain-openai>=0.1",
        "langchain-anthropic>=0.1",
        "langchain-groq>=0.1",
        "httpx",
    )
)

app = modal.App("character-agent")

# ── Supabase secret ────────────────────────────────────────────────────────────
supabase_secret = modal.Secret.from_name("supabase-character-secret")


# ─────────────────────────────────────────────────────────────────────────────
# Modal deployment — all logic lives inside the image context
# ─────────────────────────────────────────────────────────────────────────────

@app.function(
    image=image,
    secrets=[supabase_secret],
    timeout=300,
    keep_warm=1,
)
@modal.asgi_app()
def fastapi_app():
    import hashlib
    import json
    import operator
    import os
    import re
    from typing import Annotated, Any, Literal, Optional, TypedDict

    from fastapi import FastAPI, Header, HTTPException
    from fastapi.middleware.cors import CORSMiddleware
    from pydantic import BaseModel, Field

    # ── FastAPI app ───────────────────────────────────────────────────────────
    web_app = FastAPI(title="Character AI Agent", version="1.0.0")

    web_app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # ── Pydantic models ───────────────────────────────────────────────────────

    class LLMProviderConfig(BaseModel):
        provider: Literal["openai", "anthropic", "groq", "ollama"] = "openai"
        model: str = "gpt-4o-mini"
        api_key: Optional[str] = None
        endpoint: Optional[str] = None
        temperature: float = 0.75
        max_tokens: int = 1024

    class ChatRequest(BaseModel):
        character_id: str
        message: str
        conversation_id: Optional[str] = None
        llm: LLMProviderConfig = Field(default_factory=LLMProviderConfig)
        save_to_db: bool = True

    class ChatResponse(BaseModel):
        character_id: str
        character_name: str
        reply: str
        conversation_id: str
        tokens_used: Optional[int] = None

    class ConversationRequest(BaseModel):
        character_ids: list[str]
        topic: str
        user_message: Optional[str] = None
        max_rounds: int = Field(default=3, ge=1, le=10)
        llm: LLMProviderConfig = Field(default_factory=LLMProviderConfig)
        save_to_db: bool = True

    class ConversationResponse(BaseModel):
        conversation_id: str
        messages: list[dict]
        rounds_completed: int

    class ReflectRequest(BaseModel):
        character_id: str
        conversation_id: Optional[str] = None
        last_n_messages: int = Field(default=20, ge=5, le=100)
        llm: LLMProviderConfig = Field(default_factory=LLMProviderConfig)

    class ReflectResponse(BaseModel):
        character_id: str
        character_name: str
        skills_before: dict
        skills_after: dict
        diff_summary: dict
        messages_analyzed: int

    # ── LLM factory ──────────────────────────────────────────────────────────

    def build_llm(cfg: LLMProviderConfig):
        if cfg.provider == "openai":
            from langchain_openai import ChatOpenAI
            kwargs: dict[str, Any] = {
                "model": cfg.model,
                "temperature": cfg.temperature,
                "max_tokens": cfg.max_tokens,
            }
            if cfg.api_key:
                kwargs["api_key"] = cfg.api_key
            if cfg.endpoint:
                kwargs["base_url"] = cfg.endpoint
            return ChatOpenAI(**kwargs)

        elif cfg.provider == "anthropic":
            from langchain_anthropic import ChatAnthropic
            kwargs = {
                "model": cfg.model,
                "temperature": cfg.temperature,
                "max_tokens": cfg.max_tokens,
            }
            if cfg.api_key:
                kwargs["api_key"] = cfg.api_key
            return ChatAnthropic(**kwargs)

        elif cfg.provider == "groq":
            from langchain_groq import ChatGroq
            kwargs = {
                "model": cfg.model,
                "temperature": cfg.temperature,
                "max_tokens": cfg.max_tokens,
            }
            if cfg.api_key:
                kwargs["groq_api_key"] = cfg.api_key
            return ChatGroq(**kwargs)

        elif cfg.provider == "ollama":
            from langchain_openai import ChatOpenAI
            base_url = cfg.endpoint or "http://localhost:11434/v1"
            return ChatOpenAI(
                model=cfg.model,
                temperature=cfg.temperature,
                max_tokens=cfg.max_tokens,
                base_url=base_url,
                api_key="ollama",
            )

        raise ValueError(f"Unknown provider: {cfg.provider}")

    # ── Supabase helpers ──────────────────────────────────────────────────────

    def get_supabase():
        from supabase import create_client
        url = os.environ["SUPABASE_CHAR_URL"]
        key = os.environ["SUPABASE_CHAR_SERVICE_KEY"]
        return create_client(url, key)

    def fetch_character(sb, character_id: str) -> dict:
        res = sb.table("characters").select("*").eq("id", character_id).single().execute()
        if not res.data:
            raise HTTPException(status_code=404, detail=f"Character {character_id} not found")
        return res.data

    def save_message(sb, conversation_id: str, character_id: Optional[str],
                     role: str, content: str, round_number: int, sequence_number: int):
        sb.table("messages").insert({
            "conversation_id": conversation_id,
            "character_id": character_id,
            "role": role,
            "content": content,
            "round_number": round_number,
            "sequence_number": sequence_number,
        }).execute()

    def ensure_conversation(sb, character_ids: list[str], mode: str,
                             llm_config: dict, max_rounds: int,
                             topic: Optional[str] = None,
                             existing_id: Optional[str] = None) -> str:
        if existing_id:
            return existing_id
        res = sb.table("conversations").insert({
            "character_ids": character_ids,
            "mode": mode,
            "llm_config": llm_config,
            "max_rounds": max_rounds,
            "topic": topic,
        }).execute()
        return res.data[0]["id"]

    # ── System prompt builder ─────────────────────────────────────────────────

    def build_system_prompt(char: dict, other_chars: Optional[list[dict]] = None) -> str:
        personality = char.get("personality", {})
        stored_prompt = personality.get("agent_system_prompt", "")
        if stored_prompt:
            base = stored_prompt
        else:
            name = char["name"]
            gender = char.get("gender", "person")
            ethnicity = char.get("ethnicity", "")
            age = char.get("age", "")
            base = (
                f"# Character: {name}\n"
                f"You are {name}, a {age} {ethnicity} {gender}.\n"
                f"Speak always as {name}. Never break character.\n"
            )

        notes = char.get("knowledge_notes", [])
        if notes:
            note_text = "\n".join(f"- {n}" for n in notes[-10:])
            base += f"\n\n## Accumulated Knowledge\n{note_text}"

        if other_chars:
            names = ", ".join(c["name"] for c in other_chars)
            base += (
                f"\n\n## Conversation Context\n"
                f"You are in a multi-character discussion with: {names}.\n"
                f"Engage with their ideas directly. Be concise (2-4 sentences per turn).\n"
                f"Stay in character. Do NOT narrate actions."
            )

        return base

    # ── LangGraph: multi-agent conversation ───────────────────────────────────

    class MultiAgentState(TypedDict):
        messages: Annotated[list[dict], operator.add]
        current_speaker_idx: int
        rounds_completed: int
        max_rounds: int
        characters: list[dict]
        llm_cfg: LLMProviderConfig

    def make_character_node(char_idx: int):
        def character_node(state: MultiAgentState) -> dict:
            from langchain_core.messages import HumanMessage, SystemMessage

            chars = state["characters"]
            char = chars[char_idx]
            other_chars = [c for i, c in enumerate(chars) if i != char_idx]
            llm = build_llm(state["llm_cfg"])

            system_prompt = build_system_prompt(char, other_chars)
            lc_messages = [SystemMessage(content=system_prompt)]
            for m in state["messages"]:
                if m["role"] == "user":
                    lc_messages.append(HumanMessage(content=m["content"]))
                elif m["role"] == "assistant":
                    speaker = m.get("speaker", "")
                    lc_messages.append(HumanMessage(content=f"[{speaker}]: {m['content']}"))

            response = llm.invoke(lc_messages)
            reply = response.content.strip()

            new_msg = {
                "role": "assistant",
                "speaker": char["name"],
                "character_id": char["id"],
                "content": reply,
                "round": state["rounds_completed"],
            }

            next_idx = (char_idx + 1) % len(chars)
            completed = state["rounds_completed"]
            if next_idx == 0:
                completed += 1

            return {
                "messages": [new_msg],
                "current_speaker_idx": next_idx,
                "rounds_completed": completed,
            }

        character_node.__name__ = f"character_{char_idx}"
        return character_node

    def should_continue(state: MultiAgentState) -> str:
        if state["rounds_completed"] >= state["max_rounds"]:
            return "end"
        return f"character_{state['current_speaker_idx']}"

    def build_conversation_graph(num_characters: int):
        from langgraph.graph import StateGraph, END

        builder = StateGraph(MultiAgentState)
        for i in range(num_characters):
            builder.add_node(f"character_{i}", make_character_node(i))

        builder.add_node("router", lambda s: s)
        builder.set_entry_point("router")

        edge_map = {f"character_{i}": f"character_{i}" for i in range(num_characters)}
        edge_map["end"] = END
        builder.add_conditional_edges("router", should_continue, edge_map)
        for i in range(num_characters):
            builder.add_edge(f"character_{i}", "router")

        return builder.compile()

    # ── LangGraph: skill evolution (reflect) ──────────────────────────────────

    class ReflectState(TypedDict):
        character: dict
        messages_text: str
        skills_before: dict
        skills_after: dict
        diff_summary: dict
        llm_cfg: LLMProviderConfig
        messages_analyzed: int

    def load_history_node(state: ReflectState) -> dict:
        return {}

    def extract_insights_node(state: ReflectState) -> dict:
        from langchain_core.messages import HumanMessage, SystemMessage

        llm = build_llm(state["llm_cfg"])
        char = state["character"]
        personality = char.get("personality", {})
        current_skills = personality.get("skillsets", [])
        current_mindsets = personality.get("mindsets", [])

        system = (
            "You are an expert analyst extracting skill and mindset evolution signals "
            "from conversation transcripts. Be precise and data-driven. Respond ONLY with valid JSON."
        )

        prompt = f"""Analyze this conversation transcript for character "{char['name']}":

---
{state['messages_text']}
---

Current character profile:
- Skillsets: {current_skills}
- Mindsets: {current_mindsets}
- Knowledge notes: {char.get('knowledge_notes', [])}

Extract skill evolution signals. Return JSON with this exact structure:
{{
  "new_skills_demonstrated": ["skill1", "skill2"],
  "strengthened_skills": ["skill1"],
  "new_mindsets_demonstrated": ["mindset1"],
  "key_insights": ["insight1", "insight2", "insight3"],
  "updated_knowledge_notes": ["note1", "note2"],
  "confidence": 0.0
}}

Rules:
- Only include skills/mindsets clearly demonstrated in the transcript
- key_insights: max 5 concise bullet points about what this character learned/showed
- updated_knowledge_notes: replace or add to existing notes (max 15 total)
- confidence: 0.0 to 1.0 how much the character evolved
"""

        response = llm.invoke([SystemMessage(content=system), HumanMessage(content=prompt)])
        raw = response.content.strip()
        match = re.search(r"\{.*\}", raw, re.DOTALL)
        if match:
            raw = match.group(0)

        try:
            insights = json.loads(raw)
        except Exception:
            insights = {
                "new_skills_demonstrated": [],
                "strengthened_skills": [],
                "new_mindsets_demonstrated": [],
                "key_insights": [],
                "updated_knowledge_notes": [],
                "confidence": 0.0,
            }

        return {"diff_summary": insights}

    def update_profile_node(state: ReflectState) -> dict:
        char = state["character"]
        personality = dict(char.get("personality", {}))
        diff = state["diff_summary"]

        skills_before = {
            "skillsets": list(personality.get("skillsets", [])),
            "mindsets": list(personality.get("mindsets", [])),
            "knowledge_notes": list(char.get("knowledge_notes", [])),
        }

        existing_skills = set(personality.get("skillsets", []))
        existing_mindsets = set(personality.get("mindsets", []))

        for s in diff.get("new_skills_demonstrated", []) + diff.get("strengthened_skills", []):
            existing_skills.add(s)
        for m in diff.get("new_mindsets_demonstrated", []):
            existing_mindsets.add(m)

        personality["skillsets"] = sorted(existing_skills)
        personality["mindsets"] = sorted(existing_mindsets)

        new_notes = diff.get("updated_knowledge_notes", [])
        existing_notes = char.get("knowledge_notes", [])
        if new_notes:
            merged = existing_notes + [n for n in new_notes if n not in existing_notes]
            merged = merged[-15:]
        else:
            merged = existing_notes

        skills_after = {
            "skillsets": personality["skillsets"],
            "mindsets": personality["mindsets"],
            "knowledge_notes": merged,
        }

        return {
            "skills_before": skills_before,
            "skills_after": skills_after,
            "character": {**char, "personality": personality, "knowledge_notes": merged},
        }

    def save_profile_node(state: ReflectState) -> dict:
        sb = get_supabase()
        char = state["character"]
        sb.table("characters").update({
            "personality": char["personality"],
            "knowledge_notes": char.get("knowledge_notes", []),
        }).eq("id", char["id"]).execute()

        sb.table("skill_evolution_log").insert({
            "character_id": char["id"],
            "skills_before": state["skills_before"],
            "skills_after": state["skills_after"],
            "diff_summary": state["diff_summary"],
            "messages_analyzed": state["messages_analyzed"],
            "triggered_by": "manual",
        }).execute()

        return {}

    def build_reflect_graph():
        from langgraph.graph import StateGraph, END

        builder = StateGraph(ReflectState)
        builder.add_node("load_history", load_history_node)
        builder.add_node("extract_insights", extract_insights_node)
        builder.add_node("update_profile", update_profile_node)
        builder.add_node("save_profile", save_profile_node)

        builder.set_entry_point("load_history")
        builder.add_edge("load_history", "extract_insights")
        builder.add_edge("extract_insights", "update_profile")
        builder.add_edge("update_profile", "save_profile")
        builder.add_edge("save_profile", END)

        return builder.compile()

    # ── API key validation ────────────────────────────────────────────────────

    def verify_api_key(x_api_key: Optional[str] = None, authorization: Optional[str] = None):
        raw_key = None
        if x_api_key:
            raw_key = x_api_key
        elif authorization and authorization.startswith("Bearer "):
            raw_key = authorization[7:]

        if not raw_key:
            raise HTTPException(status_code=401, detail="API key required")
        if not raw_key.startswith("sk_char_"):
            raise HTTPException(status_code=401, detail="Invalid API key format")

        hashed = hashlib.sha256(raw_key.encode()).hexdigest()
        sb = get_supabase()
        res = sb.table("api_keys").select("id, is_active").eq("hashed_key", hashed).execute()

        if not res.data or not res.data[0]["is_active"]:
            raise HTTPException(status_code=401, detail="Invalid or revoked API key")

        try:
            sb.table("api_keys").update({"last_used_at": "now()"}).eq("hashed_key", hashed).execute()
        except Exception:
            pass

    # ── Routes ────────────────────────────────────────────────────────────────

    @web_app.get("/health")
    async def health():
        return {"status": "ok", "service": "character-agent"}

    @web_app.post("/chat", response_model=ChatResponse)
    async def chat(
        req: ChatRequest,
        x_api_key: Optional[str] = Header(default=None),
        authorization: Optional[str] = Header(default=None),
    ):
        verify_api_key(x_api_key, authorization)

        from langchain_core.messages import HumanMessage, SystemMessage

        sb = get_supabase()
        char = fetch_character(sb, req.character_id)
        llm = build_llm(req.llm)

        history = []
        conv_id = req.conversation_id
        if conv_id:
            hist_res = (
                sb.table("messages")
                .select("role, content, character_id")
                .eq("conversation_id", conv_id)
                .order("sequence_number")
                .limit(50)
                .execute()
            )
            history = hist_res.data or []

        lc_messages = [SystemMessage(content=build_system_prompt(char))]
        for h in history:
            if h["role"] == "user":
                lc_messages.append(HumanMessage(content=h["content"]))
            elif h["role"] == "assistant":
                lc_messages.append(HumanMessage(content=h["content"]))
        lc_messages.append(HumanMessage(content=req.message))

        response = llm.invoke(lc_messages)
        reply = response.content.strip()
        tokens = getattr(response, "usage_metadata", {}) or {}
        total_tokens = tokens.get("total_tokens")

        if req.save_to_db:
            if not conv_id:
                conv_id = ensure_conversation(
                    sb,
                    character_ids=[req.character_id],
                    mode="single",
                    llm_config=req.llm.model_dump(),
                    max_rounds=100,
                )
            seq_base = len(history)
            save_message(sb, conv_id, None, "user", req.message, 0, seq_base)
            save_message(sb, conv_id, req.character_id, "assistant", reply, 0, seq_base + 1)

        return ChatResponse(
            character_id=req.character_id,
            character_name=char["name"],
            reply=reply,
            conversation_id=conv_id or "unsaved",
            tokens_used=total_tokens,
        )

    @web_app.post("/conversation", response_model=ConversationResponse)
    async def conversation(
        req: ConversationRequest,
        x_api_key: Optional[str] = Header(default=None),
        authorization: Optional[str] = Header(default=None),
    ):
        verify_api_key(x_api_key, authorization)

        if len(req.character_ids) < 2:
            raise HTTPException(status_code=400, detail="Need at least 2 characters")
        if len(req.character_ids) > 8:
            raise HTTPException(status_code=400, detail="Max 8 characters")

        sb = get_supabase()
        chars = [fetch_character(sb, cid) for cid in req.character_ids]

        graph = build_conversation_graph(len(chars))

        seed_messages = []
        if req.topic:
            seed_messages.append({
                "role": "user", "speaker": "Host", "character_id": None,
                "content": f"Topic for discussion: {req.topic}", "round": 0,
            })
        if req.user_message:
            seed_messages.append({
                "role": "user", "speaker": "User", "character_id": None,
                "content": req.user_message, "round": 0,
            })

        initial_state: MultiAgentState = {
            "messages": seed_messages,
            "current_speaker_idx": 0,
            "rounds_completed": 0,
            "max_rounds": req.max_rounds,
            "characters": chars,
            "llm_cfg": req.llm,
        }

        final_state = graph.invoke(initial_state)
        all_messages = final_state["messages"]

        conv_id = "unsaved"
        if req.save_to_db:
            conv_id = ensure_conversation(
                sb,
                character_ids=req.character_ids,
                mode="multi",
                llm_config=req.llm.model_dump(),
                max_rounds=req.max_rounds,
                topic=req.topic,
            )
            for seq, msg in enumerate(all_messages):
                save_message(
                    sb, conv_id, msg.get("character_id"),
                    msg["role"], msg["content"],
                    msg.get("round", 0), seq,
                )
            sb.table("conversations").update({
                "status": "completed",
                "current_round": final_state["rounds_completed"],
            }).eq("id", conv_id).execute()

        return ConversationResponse(
            conversation_id=conv_id,
            messages=all_messages,
            rounds_completed=final_state["rounds_completed"],
        )

    @web_app.post("/reflect", response_model=ReflectResponse)
    async def reflect(
        req: ReflectRequest,
        x_api_key: Optional[str] = Header(default=None),
        authorization: Optional[str] = Header(default=None),
    ):
        verify_api_key(x_api_key, authorization)

        sb = get_supabase()
        char = fetch_character(sb, req.character_id)

        query = (
            sb.table("messages")
            .select("role, content, character_id")
            .order("created_at", desc=True)
            .limit(req.last_n_messages)
        )
        if req.conversation_id:
            query = query.eq("conversation_id", req.conversation_id)
        else:
            query = query.eq("character_id", req.character_id)

        msgs_res = query.execute()
        msgs = list(reversed(msgs_res.data or []))

        if not msgs:
            raise HTTPException(status_code=404, detail="No messages found for reflection")

        lines = []
        for m in msgs:
            speaker = "User" if m["role"] == "user" else f"[{char['name']}]"
            lines.append(f"{speaker}: {m['content']}")
        messages_text = "\n".join(lines)

        reflect_graph = build_reflect_graph()
        initial_state: ReflectState = {
            "character": char,
            "messages_text": messages_text,
            "skills_before": {},
            "skills_after": {},
            "diff_summary": {},
            "llm_cfg": req.llm,
            "messages_analyzed": len(msgs),
        }

        final_state = reflect_graph.invoke(initial_state)

        return ReflectResponse(
            character_id=req.character_id,
            character_name=char["name"],
            skills_before=final_state["skills_before"],
            skills_after=final_state["skills_after"],
            diff_summary=final_state["diff_summary"],
            messages_analyzed=final_state["messages_analyzed"],
        )

    return web_app
