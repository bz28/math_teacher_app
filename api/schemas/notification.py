"""Notification preference schemas."""

from pydantic import BaseModel


class NotificationPrefItem(BaseModel):
    event_type: str
    label: str
    enabled: bool


class NotificationPrefsResponse(BaseModel):
    preferences: list[NotificationPrefItem]


class UpdateNotificationPrefRequest(BaseModel):
    event_type: str
    enabled: bool
