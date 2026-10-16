// Wire shapes of the /auth router, field for field with
// api/app/schemas/auth.py and api/app/routers/auth.py.

// POST /auth/token takes an OAuth2 password form, not JSON:
// `username` carries the email.
export type LoginForm = {
  username: string;
  password: string;
};

export type TokenPair = {
  access_token: string;
  refresh_token: string;
  token_type: "bearer";
};

export type SetPasswordRequest = {
  token: string;
  password: string;
};

export type ForgotPasswordRequest = {
  email: string;
};

export type ForgotPasswordResponse = {
  detail: string;
};

// FastAPI's HTTPException body.
export type ErrorBody = {
  detail: string;
};
