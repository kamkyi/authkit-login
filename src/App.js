import { useEffect, useMemo, useState } from "react";
import "./App.css";

const WORKOS_CLIENT_ID = process.env.REACT_APP_WORKOS_CLIENT_ID || "";
const WORKOS_REDIRECT_URI =
  process.env.REACT_APP_WORKOS_REDIRECT_URI || "http://localhost:3000/callback";
const WORKOS_PROVIDER = process.env.REACT_APP_WORKOS_PROVIDER || "authkit";
const WORKOS_CONNECTION = process.env.REACT_APP_WORKOS_CONNECTION || "";
const BACKEND_CALLBACK_URL =
  process.env.REACT_APP_BACKEND_CALLBACK_URL ||
  "http://localhost:9000/authkit/callback";
const BACKEND_LOGOUT_URL =
  process.env.REACT_APP_BACKEND_LOGOUT_URL ||
  "http://localhost:9000/authkit/logout";
const BACKEND_LOGOUT_OTHERS_URL =
  process.env.REACT_APP_BACKEND_LOGOUT_OTHERS_URL ||
  "http://localhost:9000/authkit/logout/others";
const AUTH_RESPONSE_STORAGE_KEY = "workos_authkit_response";

function parseResponsePayload(rawText) {
  const trimmed = rawText.trim();
  if (!trimmed) {
    throw new Error("Backend returned an empty response.");
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    let start = -1;
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = 0; index < trimmed.length; index += 1) {
      const char = trimmed[index];

      if (start < 0) {
        if (char === "{") {
          start = index;
          depth = 1;
        }
        continue;
      }

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === "\"") {
          inString = false;
        }
        continue;
      }

      if (char === "\"") {
        inString = true;
        continue;
      }

      if (char === "{") {
        depth += 1;
      } else if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          return JSON.parse(trimmed.slice(start, index + 1));
        }
      }
    }
  }

  throw new Error("Backend returned invalid JSON.");
}

function readStoredAuthResponse() {
  const raw = localStorage.getItem(AUTH_RESPONSE_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch {
    localStorage.removeItem(AUTH_RESPONSE_STORAGE_KEY);
    return null;
  }
}

function clearLocalAuthData() {
  localStorage.removeItem(AUTH_RESPONSE_STORAGE_KEY);

  Object.keys(sessionStorage).forEach((key) => {
    if (key === "workos_oauth_state" || key.startsWith("workos_callback_status_")) {
      sessionStorage.removeItem(key);
    }
  });
}

function buildAuthUrl() {
  const params = new URLSearchParams({
    client_id: WORKOS_CLIENT_ID,
    redirect_uri: WORKOS_REDIRECT_URI,
    response_type: "code",
    provider: WORKOS_PROVIDER,
  });

  if (WORKOS_CONNECTION) {
    params.set("connection", WORKOS_CONNECTION);
  }

  const state = crypto.randomUUID();
  sessionStorage.setItem("workos_oauth_state", state);
  params.set("state", state);

  return `https://api.workos.com/user_management/authorize?${params.toString()}`;
}

function Home() {
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [loadingLogout, setLoadingLogout] = useState("");
  const [authResponse, setAuthResponse] = useState(() => readStoredAuthResponse());

  const canSignIn = useMemo(() => WORKOS_CLIENT_ID.trim().length > 0, []);
  const accessToken = authResponse?.session?.accessToken || "";
  const userEmail = authResponse?.user?.email || "";
  const logoutDisabled = loadingLogout.length > 0 || !accessToken;

  const handleSignIn = () => {
    setInfo("");
    if (!canSignIn) {
      setError("Set REACT_APP_WORKOS_CLIENT_ID before signing in.");
      return;
    }

    setError("");
    window.location.assign(buildAuthUrl());
  };

  const handleLogout = async (url, successMessage, clearLocalDataAfterLogout) => {
    setInfo("");
    setError("");

    if (!accessToken) {
      setError("No access token found. Sign in first.");
      return;
    }

    try {
      setLoadingLogout(url);
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ accessToken }),
      });
      const responseText = await response.text();

      if (!response.ok) {
        throw new Error(
          responseText || `Logout API failed (${response.status})`,
        );
      }

      if (clearLocalDataAfterLogout) {
        clearLocalAuthData();
        setAuthResponse(null);
      }

      setInfo(successMessage);
    } catch (logoutError) {
      setError(logoutError.message || "Logout failed.");
    } finally {
      setLoadingLogout("");
    }
  };

  return (
    <main className="container">
      <h1>AuthKit Demo</h1>
      <p>Sign in with Google via WorkOS AuthKit.</p>
      <div className="buttonRow">
        <button type="button" className="primaryBtn" onClick={handleSignIn}>
          Continue with Google
        </button>
        <button
          type="button"
          className="secondaryBtn"
          disabled={logoutDisabled}
          onClick={() =>
            handleLogout(
              BACKEND_LOGOUT_URL,
              "Logged out from this device.",
              true,
            )
          }
        >
          Logout This Device
        </button>
        <button
          type="button"
          className="secondaryBtn"
          disabled={logoutDisabled}
          onClick={() =>
            handleLogout(
              BACKEND_LOGOUT_OTHERS_URL,
              "Logged out from other devices.",
              false,
            )
          }
        >
          Logout Other Devices
        </button>
      </div>
      {userEmail ? (
        <p className="hintText">Signed in as {userEmail}</p>
      ) : (
        <p className="hintText">No callback token stored yet.</p>
      )}
      {error ? <p className="errorText">{error}</p> : null}
      {info ? <p className="successText">{info}</p> : null}
      <p className="hintText">Redirect URI: {WORKOS_REDIRECT_URI}</p>
      <p className="hintText">Logout URL: {BACKEND_LOGOUT_URL}</p>
      <p className="hintText">Logout Others URL: {BACKEND_LOGOUT_OTHERS_URL}</p>
    </main>
  );
}

function Callback() {
  const [status, setStatus] = useState("Processing callback...");
  const [error, setError] = useState("");
  const callbackLockPrefix = "workos_callback_status_";

  useEffect(() => {
    const run = async () => {
      const url = new URL(window.location.href);
      const code = url.searchParams.get("code");
      const workosError = url.searchParams.get("error");
      const workosErrorDescription = url.searchParams.get("error_description");
      const returnedState = url.searchParams.get("state");
      const savedState = sessionStorage.getItem("workos_oauth_state");

      if (workosError) {
        setError(workosErrorDescription || workosError);
        setStatus("Callback failed.");
        return;
      }

      if (!code) {
        setError("No authorization code found in callback URL.");
        setStatus("Callback failed.");
        return;
      }

      const callbackLockKey = `${callbackLockPrefix}${code}`;
      const callbackLockStatus = sessionStorage.getItem(callbackLockKey);
      if (callbackLockStatus === "pending" || callbackLockStatus === "done") {
        setStatus("Code already processed. Skipping duplicate callback.");
        return;
      }

      if (savedState && returnedState && savedState !== returnedState) {
        setError("State mismatch. Please retry sign in.");
        setStatus("Callback failed.");
        return;
      }

      try {
        sessionStorage.setItem(callbackLockKey, "pending");
        const response = await fetch(BACKEND_CALLBACK_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            code,
            state: returnedState || undefined,
            redirectUri: WORKOS_REDIRECT_URI,
          }),
        });

        const body = await response.text();
        if (!response.ok) {
          throw new Error(
            body || `Backend callback failed (${response.status})`,
          );
        }

        const payload = parseResponsePayload(body);
        const accessToken = payload?.session?.accessToken;
        if (!accessToken) {
          throw new Error("Callback response did not include session.accessToken.");
        }

        localStorage.setItem(
          AUTH_RESPONSE_STORAGE_KEY,
          JSON.stringify(payload),
        );
        sessionStorage.removeItem("workos_oauth_state");
        sessionStorage.setItem(callbackLockKey, "done");
        setStatus("Code forwarded to backend successfully. Session stored locally.");
      } catch (forwardError) {
        sessionStorage.removeItem(callbackLockKey);
        setError(forwardError.message);
        setStatus("Callback failed.");
      }
    };

    run();
  }, []);

  return (
    <main className="container">
      <h1>Auth Callback</h1>
      <p>{status}</p>
      {error ? <p className="errorText">{error}</p> : null}
      <p className="hintText">Backend callback URL: {BACKEND_CALLBACK_URL}</p>
      <a className="primaryLink" href="/">
        Back to Home
      </a>
    </main>
  );
}

function App() {
  return window.location.pathname === "/callback" ? <Callback /> : <Home />;
}

export default App;
