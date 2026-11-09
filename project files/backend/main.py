
import os

from dotenv import load_dotenv
from fastapi import FastAPI, Response, status, Depends
from fastapi.middleware.cors import CORSMiddleware

from pydantic import BaseModel
from supabase import create_client

from auth import get_current_user
from supabase_client import get_supabase_client
from cases import router as cases_router
from cdr import router as cdr_router

load_dotenv()

app = FastAPI(title="Case and Evidence Management API")

class LoginRequest(BaseModel):
    email: str
    password: str


@app.post("/api/auth/login")
def login_user(credentials: LoginRequest, response: Response):
    """
    Exchanges investigator credentials for an access token.
    Enables frontend authentication without exposing secret keys.
    """
    supabase_url = os.getenv("SUPABASE_URL", "")
    supabase_key = os.getenv("SUPABASE_SECRET_KEY", "")
    if not supabase_url or not supabase_key:
        # Development / demonstration fallback when Supabase keys are not set
        if credentials.email and len(credentials.password) >= 6:
            return {
                "access_token": "dev_session_token_investigator_001",
                "token_type": "bearer",
                "user": {
                    "id": "11111111-1111-4111-8111-111111111111",
                    "email": credentials.email.strip(),
                },
            }
        response.status_code = status.HTTP_500_INTERNAL_SERVER_ERROR
        return {"detail": "Supabase configuration is missing on server."}

    try:
        auth_client = create_client(supabase_url, supabase_key)
        auth_res = auth_client.auth.sign_in_with_password({
            "email": credentials.email.strip(),
            "password": credentials.password,
        })
        if not auth_res.session:
            response.status_code = status.HTTP_401_UNAUTHORIZED
            return {"detail": "Invalid credentials."}

        return {
            "access_token": auth_res.session.access_token,
            "token_type": "bearer",
            "user": {
                "id": auth_res.user.id,
                "email": auth_res.user.email,
            },
        }
    except Exception:
        response.status_code = status.HTTP_401_UNAUTHORIZED
        return {"detail": "Authentication failed. Please check your email and password."}


@app.get("/api/auth/me")
def get_current_user_profile(current_user: dict = Depends(get_current_user)):
    """
    Validates the bearer token and returns authenticated user identity.
    Used by frontend to verify stored sessions.
    """
    return {"user": current_user}


# Include Case Management routes under /api/cases
app.include_router(cases_router)

# Include CDR Analysis routes under /api/cdr
app.include_router(cdr_router)

frontend_url = os.getenv(
    "FRONTEND_URL",
    "http://localhost:3000"
)

allowed_origins = list({
    frontend_url,
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3001",
    "http://localhost:8000",
    "http://127.0.0.1:8000",
})

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def home():
    return {"message": "Case and Evidence Management API"}


@app.get("/health")
def health_check():
    return {
        "status": "ok",
        "message": "Backend is running"
    }


@app.get("/dev/test-db")
@app.get("/test-db")
def test_database_connection(response: Response):
    """
    Temporary development-only endpoint to test access to the Supabase cases table.
    Does NOT return any private records, table rows, or secret credentials.
    """
    try:
        client = get_supabase_client()
        # Query cases table for count with limit 0 so no records or credentials are leaked
        query_result = client.table("cases").select("id", count="exact").limit(0).execute()
        return {
            "status": "connected",
            "message": "Successfully connected to Supabase database",
            "table": "cases",
            "accessible": True,
        }
    except ValueError:
        response.status_code = status.HTTP_500_INTERNAL_SERVER_ERROR
        return {
            "status": "error",
            "message": "Database configuration error. Please check environment variables.",
        }
    except Exception:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return {
            "status": "error",
            "message": "Database connection failed. Please check network connectivity and credentials.",
        }

