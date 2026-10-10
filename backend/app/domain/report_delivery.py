from enum import StrEnum


class ReportDeliveryStatus(StrEnum):
    SENT = "sent"
    FAILED = "failed"
    IN_PROGRESS = "in_progress"
    UNCERTAIN = "uncertain"
