import uuid

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from api.core.auth import decode_access_token

security = HTTPBearer()


class CurrentUser:
    def __init__(self, user_id: uuid.UUID, role: str):
        self.user_id = user_id
        self.role = role


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
) -> CurrentUser:
    payload = decode_access_token(credentials.credentials)
    if payload is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")
    return CurrentUser(user_id=uuid.UUID(str(payload["sub"])), role=str(payload["role"]))


async def require_teacher(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    if user.role != "teacher":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Teacher access required")
    return user
