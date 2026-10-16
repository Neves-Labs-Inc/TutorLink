// What the /auth endpoints answer, as the prototype shows it. The details
// are copied verbatim from api/app/routers/auth.py; the link lifetimes
// from api/app/services/password_link_service.py.
import type {
  ErrorBody,
  ForgotPasswordRequest,
  ForgotPasswordResponse,
  LoginForm,
  SetPasswordRequest,
  TokenPair,
} from "@/pages/prototype/auth/types/api";

export const INVALID_CREDENTIALS_DETAIL = "Incorrect email or password";
export const RATE_LIMITED_DETAIL = "Too many login attempts. Try again later.";
export const INVALID_LINK_DETAIL = "This link is invalid or has expired";
export const INVALID_PASSWORD_DETAIL =
  "Password must be between 8 characters and 72 bytes";
export const FORGOT_PASSWORD_DETAIL =
  "If an account exists for that email, we sent a link to reset the password.";

export const INVITE_TTL_DAYS = 7;
export const RESET_TTL_HOURS = 48;
// A realistic Retry-After for the login limiter's sliding window.
export const MOCK_RETRY_AFTER_SECONDS = 14 * 60 + 32;
export const MOCK_LATENCY_MS = 900;

export const MOCK_EMAIL = "maria.lopez@mshelpinghands.com";
export const MOCK_TOKEN = "q3J9…link-token…V0c";

const MOCK_TOKEN_PAIR: TokenPair = {
  access_token: "eyJhbGciOiJIUzI1NiJ9.mock-access",
  refresh_token: "mock-refresh",
  token_type: "bearer",
};

type WireBody =
  | LoginForm
  | SetPasswordRequest
  | ForgotPasswordRequest
  | ForgotPasswordResponse
  | TokenPair
  | ErrorBody;

// One request/response pair, rendered in the Wire note under each screen.
export type WireExchange = {
  method: "POST";
  path: string;
  request: WireBody;
  status: number | null;
  headers?: Record<string, string>;
  response: WireBody | null;
};

const LOGIN_REQUEST: LoginForm = { username: MOCK_EMAIL, password: "••••••••" };
const SET_REQUEST: SetPasswordRequest = {
  token: MOCK_TOKEN,
  password: "••••••••",
};
const REFRESH_COOKIE = {
  "Set-Cookie": "refresh_token=…; HttpOnly; SameSite=Lax; Path=/auth",
};

export const WIRE = {
  loginOk: {
    method: "POST",
    path: "/auth/token",
    request: LOGIN_REQUEST,
    status: 200,
    headers: REFRESH_COOKIE,
    response: MOCK_TOKEN_PAIR,
  },
  loginWrong: {
    method: "POST",
    path: "/auth/token",
    request: LOGIN_REQUEST,
    status: 401,
    response: { detail: INVALID_CREDENTIALS_DETAIL },
  },
  loginLocked: {
    method: "POST",
    path: "/auth/token",
    request: LOGIN_REQUEST,
    status: 429,
    headers: { "Retry-After": String(MOCK_RETRY_AFTER_SECONDS) },
    response: { detail: RATE_LIMITED_DETAIL },
  },
  loginOffline: {
    method: "POST",
    path: "/auth/token",
    request: LOGIN_REQUEST,
    status: null,
    response: null,
  },
  forgotOk: {
    method: "POST",
    path: "/auth/password/forgot",
    request: { email: MOCK_EMAIL },
    status: 202,
    response: { detail: FORGOT_PASSWORD_DETAIL },
  },
  forgotOffline: {
    method: "POST",
    path: "/auth/password/forgot",
    request: { email: MOCK_EMAIL },
    status: null,
    response: null,
  },
  setOk: {
    method: "POST",
    path: "/auth/password/set",
    request: SET_REQUEST,
    status: 200,
    headers: REFRESH_COOKIE,
    response: MOCK_TOKEN_PAIR,
  },
  setBadPassword: {
    method: "POST",
    path: "/auth/password/set",
    request: SET_REQUEST,
    status: 422,
    response: { detail: INVALID_PASSWORD_DETAIL },
  },
  setDeadLink: {
    method: "POST",
    path: "/auth/password/set",
    request: SET_REQUEST,
    status: 400,
    response: { detail: INVALID_LINK_DETAIL },
  },
  setOffline: {
    method: "POST",
    path: "/auth/password/set",
    request: SET_REQUEST,
    status: null,
    response: null,
  },
} satisfies Record<string, WireExchange>;

export function waitForMockLatency(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, MOCK_LATENCY_MS));
}
