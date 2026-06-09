"""
Drishyamitra LangGraph Agent Workflow
======================================
Compiles the state machine that routes user chat queries through
the Orchestrator agent to specialized sub-agents.
"""

import logging
from typing import Dict, Any, List, TypedDict

from langgraph.graph import StateGraph, END

from agents.orchestrator import OrchestratorAgent
from agents.search_agent import SearchAgent
from agents.memory_agent import MemoryAgent
from agents.album_agent import AlbumAgent
from agents.sharing_agent import SharingAgent
from agents.vision_agent import VisionAgent

logger = logging.getLogger(__name__)

# ── State Definition ─────────────────────────────────────────────────────────

class AgentState(TypedDict):
    user_query: str
    messages: List[Dict[str, Any]]
    photo_ids: List[int]
    person_ids: List[int]
    album_id: Any
    recipient: str
    platform: str  # "email" or "whatsapp"
    response_text: str
    next_step: str  # "search", "memory", "album", "sharing", "vision", "end"
    original_intent: str
    action_logs: List[str]

# ── Node Definitions ─────────────────────────────────────────────────────────

def orchestrator_node(state: AgentState) -> Dict[str, Any]:
    """Execute supervisor routing."""
    logger.info("Executing orchestrator_node")
    res = OrchestratorAgent.route(state)
    
    # Extract details
    next_step = res.get("next_step", "end")
    photo_ids = res.get("photo_ids", [])
    action_logs = list(res.get("action_logs", []))
    
    # Compound routing helper: If sharing or album is requested but no photos
    # are selected yet, route to search first, saving original intent.
    if next_step in ["sharing", "album"] and not photo_ids:
        res["original_intent"] = next_step
        res["next_step"] = "search"
        action_logs.append(
            f"[workflow] Intent is '{next_step}' but no photos selected. Routing to 'search' first."
        )
        res["action_logs"] = action_logs
        
    return res

def search_node(state: AgentState) -> Dict[str, Any]:
    """Execute search query matching."""
    logger.info("Executing search_node")
    return SearchAgent.run(state)

def memory_node(state: AgentState) -> Dict[str, Any]:
    """Execute person lookup/relationship queries."""
    logger.info("Executing memory_node")
    return MemoryAgent.run(state)

def album_node(state: AgentState) -> Dict[str, Any]:
    """Execute album creation / photo assignment."""
    logger.info("Executing album_node")
    return AlbumAgent.run(state)

def sharing_node(state: AgentState) -> Dict[str, Any]:
    """Execute photo delivery dispatch."""
    logger.info("Executing sharing_node")
    return SharingAgent.run(state)

def vision_node(state: AgentState) -> Dict[str, Any]:
    """Execute image visual details analysis queries."""
    logger.info("Executing vision_node")
    return VisionAgent.run(state)

# ── Router Definitions ──────────────────────────────────────────────────────

def orchestrator_router(state: AgentState) -> str:
    """Decide where to go from orchestrator."""
    next_step = state.get("next_step", "end")
    if next_step in ["search", "memory", "album", "sharing", "vision"]:
        return next_step
    return END

def search_router(state: AgentState) -> str:
    """Decide where to go from search node (supports compound intent)."""
    orig = state.get("original_intent", "")
    if orig in ["sharing", "album"]:
        # Clear original intent so we don't loop indefinitely
        state["original_intent"] = ""
        return orig
    return END

# ── Graph Assembly ──────────────────────────────────────────────────────────

workflow = StateGraph(AgentState)

# Add all nodes
workflow.add_node("orchestrator", orchestrator_node)
workflow.add_node("search", search_node)
workflow.add_node("memory", memory_node)
workflow.add_node("album", album_node)
workflow.add_node("sharing", sharing_node)
workflow.add_node("vision", vision_node)

# Set entry point
workflow.set_entry_point("orchestrator")

# Add conditional routing from orchestrator
workflow.add_conditional_edges(
    "orchestrator",
    orchestrator_router,
    {
        "search": "search",
        "memory": "memory",
        "album": "album",
        "sharing": "sharing",
        "vision": "vision",
        END: END
    }
)

# Add conditional routing from search (to support compound search->share/album flows)
workflow.add_conditional_edges(
    "search",
    search_router,
    {
        "sharing": "sharing",
        "album": "album",
        END: END
    }
)

# Other agents route straight to END
workflow.add_edge("memory", END)
workflow.add_edge("album", END)
workflow.add_edge("sharing", END)
workflow.add_edge("vision", END)

# Compile the workflow
app_workflow = workflow.compile()

# ── Entrypoint function ─────────────────────────────────────────────────────

def run_agent_workflow(prompt: str, history: List[Dict[str, Any]] = None, photo_ids: List[int] = None) -> Dict[str, Any]:
    """Runs the compiled LangGraph workflow state machine.

    Args:
        prompt (str): Natural language prompt/query from the user.
        history (list, optional): Conversational history list.
        photo_ids (list, optional): Pre-selected photo IDs list.

    Returns:
        dict: A dictionary containing 'response' (str) and 'actions' (list).
    """
    initial_state = {
        "user_query": prompt,
        "messages": history or [],
        "photo_ids": photo_ids or [],
        "person_ids": [],
        "album_id": None,
        "recipient": "",
        "platform": "email",
        "response_text": "",
        "next_step": "",
        "original_intent": "",
        "action_logs": []
    }
    
    try:
        final_state = app_workflow.invoke(initial_state)
        
        # Structure actions from logs
        actions = []
        for log in final_state.get("action_logs", []):
            actions.append({"log": log})
            
        response_val = final_state.get("response_text", "").strip()
        if not response_val:
            response_val = (
                "I'm your Drishyamitra AI assistant! I can help you find photos by person, "
                "date, or event, share photos via email or WhatsApp, create albums, and show "
                "analytics. What would you like to do?"
            )
            
        return {
            "response": response_val,
            "actions": actions,
            "photo_ids": final_state.get("photo_ids", []),
            "person_ids": final_state.get("person_ids", []),
            "album_id": final_state.get("album_id")
        }
    except Exception as exc:
        logger.error("Failed to run agent workflow: %s", exc, exc_info=True)
        return {
            "response": "I encountered an error running my assistant workflow.",
            "actions": [{"log": f"[error] {exc}"}],
            "photo_ids": [],
            "person_ids": [],
            "album_id": None
        }

