from enum import StrEnum


class IntegrationResult(StrEnum):
    SUCCESS = "success"
    FAILURE = "failure"


class IntegrationExecutionState(StrEnum):
    NEVER_RUN = "never_run"
    RUNNING = "running"
    TIMED_OUT = "timed_out"
    FINISHED = "finished"


class IntegrationHealth(StrEnum):
    DISABLED = "disabled"
    TIMED_OUT = "timed_out"
    STALE = "stale"
    RUNNING = "running"
    NEVER_RUN = "never_run"
    ERROR = "error"
    HEALTHY = "healthy"
