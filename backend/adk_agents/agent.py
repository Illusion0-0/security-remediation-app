from __future__ import annotations

from typing import Any

from .prompts import (
    FIXER_INSTRUCTION,
    SCANNER_INSTRUCTION,
    SUMMARY_INSTRUCTION,
    VALIDATOR_INSTRUCTION,
)

try:
    from google.adk.agents import LlmAgent, ParallelAgent, SequentialAgent
except Exception:  # pragma: no cover
    class LlmAgent:  # type: ignore[override]
        def __init__(self, name: str, description: str, instruction: str, **kwargs: Any) -> None:
            self.name = name
            self.description = description
            self.instruction = instruction
            self.kwargs = kwargs

    class ParallelAgent:  # type: ignore[override]
        def __init__(self, name: str, description: str, sub_agents: list[Any]) -> None:
            self.name = name
            self.description = description
            self.sub_agents = sub_agents

    class SequentialAgent:  # type: ignore[override]
        def __init__(self, name: str, description: str, sub_agents: list[Any]) -> None:
            self.name = name
            self.description = description
            self.sub_agents = sub_agents

scanner_agent = LlmAgent(
    name="java_vulnerability_scanner_agent",
    description="Scans Java Maven projects for dependency vulnerabilities",
    instruction=SCANNER_INSTRUCTION,
)

fixer_agent = LlmAgent(
    name="java_vulnerability_fixer_agent",
    description="Creates and applies dependency remediation changes",
    instruction=FIXER_INSTRUCTION,
)

validator_agent = LlmAgent(
    name="java_vulnerability_validator_agent",
    description="Validates remediation changes",
    instruction=VALIDATOR_INSTRUCTION,
)

summary_agent = LlmAgent(
    name="java_vulnerability_summary_agent",
    description="Builds executive summary and user-facing explanation",
    instruction=SUMMARY_INSTRUCTION,
)

remediation_parallel_agent = ParallelAgent(
    name="java_vulnerability_parallel_stage",
    description="Parallel stage for validation and summary generation",
    sub_agents=[validator_agent, summary_agent],
)

root_agent = SequentialAgent(
    name="java_vulnerabilities_remover_v2",
    description="ADK root agent: scanner -> fixer -> parallel(validation, summary)",
    sub_agents=[scanner_agent, fixer_agent, remediation_parallel_agent],
)