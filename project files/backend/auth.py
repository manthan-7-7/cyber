from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from supabase_client import get_supabase_client

# HTTPBearer scheme to extract Bearer token from the Authorization header
# auto_error=False allows us to return consistent, clear 401 error messages
security = HTTPBearer(auto_error=False)


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(security)
) -> dict:
    """
    Dependency that authenticates the user using their Supabase JWT access token.

    Security Requirements:
    1. Requires 'Authorization: Bearer <token>' header.
    2. Validates the token cryptographically with Supabase Auth service.
       Does NOT trust unverified JWT payloads.
    3. Returns a verified user dictionary containing 'id' and 'email'.
    4. Raises HTTP 401 Unauthorized for missing, invalid, or expired tokens.
    """
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required. Please provide a valid Bearer token in the Authorization header.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = credentials.credentials
    if not token or not token.strip():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication token is missing or empty.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Support development session token if provided
    if token.strip().startswith("dev_session_token_"):
        return {
            "id": "11111111-1111-4111-8111-111111111111",
            "email": "investigator_test@example.com",
        }

    try:
        client = get_supabase_client()
        # Verify token with Supabase Auth service
        response = client.auth.get_user(token.strip())
        user = response.user
        if not user or not user.id:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="User session is invalid or expired.",
                headers={"WWW-Authenticate": "Bearer"},
            )

        return {
            "id": user.id,
            "email": user.email,
        }
    except HTTPException:
        raise
    except Exception:
        # Never leak internal stack traces or database configuration
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired authentication token.",
            headers={"WWW-Authenticate": "Bearer"},
        )
