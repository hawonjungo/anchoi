import "./App.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { GoogleMap, Marker, InfoWindow, useJsApiLoader } from "@react-google-maps/api";
import { apiFetch } from "./lib/apiClient";
import addSpotHero from "./assets/banner.png";

export default function App() {
  const env = import.meta.env;
  const API_BASE = env.VITE_API_BASE_URL;
  const cleanEnv = (v) => {
    if (typeof v !== "string") return "";
    return v.trim().replace(/^['"]|['"]$/g, "");
  };

  // ==================================================
  // AUTH (Cognito Hosted UI - Authorization Code + PKCE)
  // ==================================================
  const COGNITO_DOMAIN = cleanEnv(env.VITE_COGNITO_DOMAIN)
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
  const COGNITO_CLIENT_ID = cleanEnv(env.VITE_COGNITO_CLIENT_ID);
  const COGNITO_REDIRECT_URI =
    cleanEnv(env.VITE_COGNITO_REDIRECT_URI) || window.location.origin + "/auth/callback";
  const COGNITO_LOGOUT_REDIRECT_URI =
    cleanEnv(env.VITE_COGNITO_LOGOUT_REDIRECT_URI) || window.location.origin + "/";

  const AUTH_STORAGE_KEY = "anchoi_auth";
  const SAVED_PLANS_CACHE_KEY = "anchoi_saved_plans_cache";
  const [authUser, setAuthUser] = useState(null); // { name, picture, email }
  const [isAuthLoading, setIsAuthLoading] = useState(false);
  const didInitRef = useRef(false); // Guard against double init/exchange in React 18 StrictMode (dev)

  const saveAuthTokens = (tokens) => {
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(tokens));
  };

  const readAuthTokens = () => {
    try {
      const raw = localStorage.getItem(AUTH_STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  };

  const clearAuthTokens = () => {
    localStorage.removeItem(AUTH_STORAGE_KEY);
  };

  const readSavedPlansCache = () => {
    try {
      const raw = localStorage.getItem(SAVED_PLANS_CACHE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  };

  const writeSavedPlansCache = (plans) => {
    try {
      localStorage.setItem(SAVED_PLANS_CACHE_KEY, JSON.stringify(plans || []));
    } catch {
      // ignore cache write errors
    }
  };

  // IMPORTANT: API Gateway JWT authorizer (Cognito) commonly validates the ID token (aud claim).
  // Use id_token to call protected APIs.
  const getIdToken = () => {
    const t = readAuthTokens();
    if (!t || !t.id_token) return null;
    if (t.expires_at && Date.now() > t.expires_at) return null;
    return t.id_token;
  };

  const randomString = (len = 96) => {
    const bytes = new Uint8Array(len);
    crypto.getRandomValues(bytes);
    let s = "";
    for (let i = 0; i < bytes.length; i++) s += (bytes[i] % 36).toString(36);
    return s;
  };

  const base64url = (buffer) => {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    const b64 = btoa(binary);
    // url-safe base64
    return b64.split("+").join("-").split("/").join("_").split("=").join("");
  };

  const sha256 = async (text) => {
    const enc = new TextEncoder().encode(text);
    return crypto.subtle.digest("SHA-256", enc);
  };

  // Normalize scopes from env into whitespace-delimited format.
  const normalizeScopes = (raw) => {
    return (raw || "")
      .replace(/[,+]/g, " ")
      .trim()
      .split(/\s+/)
      .join(" ");
  };

  const startLogin = async () => {
    setIsAuthLoading(true);
    if (!COGNITO_DOMAIN || !COGNITO_CLIENT_ID) {
      const missing = [];
      if (!COGNITO_DOMAIN) missing.push("VITE_COGNITO_DOMAIN");
      if (!COGNITO_CLIENT_ID) missing.push("VITE_COGNITO_CLIENT_ID");
      alert(
        "Missing Cognito env vars: " + missing.join(" / ") + ". Check .env and restart dev server."
      );
      setIsAuthLoading(false);
      return;
    }

    const verifier = randomString(96);
    const challenge = base64url(await sha256(verifier));
    sessionStorage.setItem("pkce_verifier", verifier);

    // Include profile scope by default so user pictures are available.
    const scopes = normalizeScopes(env.VITE_COGNITO_SCOPES || "openid email profile");

    const url = new URL("https://" + COGNITO_DOMAIN + "/oauth2/authorize");
    url.searchParams.set("client_id", COGNITO_CLIENT_ID);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("redirect_uri", COGNITO_REDIRECT_URI);
    url.searchParams.set("scope", scopes);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("code_challenge", challenge);

    // Do not force identity_provider so Hosted UI can show all login providers.
    window.location.assign(url.toString());
  };

  const exchangeCodeForTokens = async (code) => {
    const verifier = sessionStorage.getItem("pkce_verifier");
    if (!verifier) throw new Error("Missing PKCE verifier. Please log in again.");

    const tokenUrl = "https://" + COGNITO_DOMAIN + "/oauth2/token";

    const body = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: COGNITO_CLIENT_ID,
      redirect_uri: COGNITO_REDIRECT_URI,
      code,
      code_verifier: verifier,
    });

    const res = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    if (!res.ok) {
      const t = await res.text();
      throw new Error("Token exchange failed: " + res.status + " " + t);
    }

    const data = await res.json();
    const expiresAt = Date.now() + Number(data.expires_in || 0) * 1000;

    const tokens = {
      access_token: data.access_token,
      id_token: data.id_token,
      refresh_token: data.refresh_token,
      token_type: data.token_type,
      expires_at: expiresAt,
    };

    saveAuthTokens(tokens);
    sessionStorage.removeItem("pkce_verifier");
    return tokens;
  };

  const loadUserFromUserInfo = async (accessToken) => {
    const res = await fetch("https://" + COGNITO_DOMAIN + "/oauth2/userInfo", {
      headers: { Authorization: "Bearer " + accessToken },
    });
    if (!res.ok) return null;

    const info = await res.json();
    return {
      name: info.name || info.given_name || info.email || "User",
      picture: info.picture || null,
      email: info.email || null,
    };
  };

  const logout = () => {
    clearAuthTokens();
    sessionStorage.removeItem("pkce_verifier");
    setAuthUser(null);

    if (!COGNITO_DOMAIN || !COGNITO_CLIENT_ID) {
      window.location.assign(window.location.origin + "/");
      return;
    }

    const url = new URL("https://" + COGNITO_DOMAIN + "/logout");
    url.searchParams.set("client_id", COGNITO_CLIENT_ID);
    url.searchParams.set("logout_uri", COGNITO_LOGOUT_REDIRECT_URI);
    window.location.assign(url.toString());
  };

  // Callback: ?code=...
  useEffect(() => {
    // Guard against duplicate init that can exchange the same code twice.
    if (didInitRef.current) return;
    didInitRef.current = true;

    const url = new URL(window.location.href);
    const code = url.searchParams.get("code");
    const err = url.searchParams.get("error");

    const init = async () => {
      if (!COGNITO_DOMAIN || !COGNITO_CLIENT_ID) return;

      setIsAuthLoading(true);
      try {
        if (err) {
          const desc = url.searchParams.get("error_description") || err;
          throw new Error(desc);
        }

        let tokens = readAuthTokens();

        if (code) {
          tokens = await exchangeCodeForTokens(code);

          url.searchParams.delete("code");
          url.searchParams.delete("state");
          window.history.replaceState({}, "", url.pathname + url.search + url.hash);
        }

        const access = tokens && tokens.access_token;
        if (access) {
          const user = await loadUserFromUserInfo(access);
          if (user) setAuthUser(user);
        }
      } catch (e) {
        console.error(e);
        clearAuthTokens();
        setAuthUser(null);
        alert("Login failed: " + (e && e.message ? e.message : "Unknown error"));
      } finally {
        setIsAuthLoading(false);
      }
    };

    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ========================
  // API helper: attach Authorization
  // ========================
  const apiFetchAuthed = async (path, init = {}) => {
    const token = getIdToken();
    if (!token) {
      const e = new Error("NO_AUTH");
      e.code = "NO_AUTH";
      throw e;
    }

    const headers = new Headers(init.headers || {});
    headers.set("Authorization", "Bearer " + token);

    if (!headers.has("Content-Type") && init.body) {
      headers.set("Content-Type", "application/json");
    }

    // apiFetch() defaults to Amplify auth injection; disable it because we already
    // attach Cognito Hosted UI token above.
    return apiFetch(path, { ...init, headers }, { auth: false });
  };

  // ==================================================
  // APP STATE
  // ==================================================

  // -------- Public share (read-only) --------
  const [sharedPlanId, setSharedPlanId] = useState(null);
  const [, setIsLoadingSharedPlan] = useState(false);
  const isPublicView = !!sharedPlanId;

  // -------- Form state --------
  const [videoUrl, setVideoUrl] = useState("");
  const [spotName, setSpotName] = useState("");
  const [address, setAddress] = useState("");

  // -------- Data state --------
  const [spots, setSpots] = useState([]);
  const [selectedSpot, setSelectedSpot] = useState(null);
  const [sharedSpotDetailsById, setSharedSpotDetailsById] = useState({});

  // -------- Plan state --------
  const [planItems, setPlanItems] = useState([]);
  const [followMode, setFollowMode] = useState(true);

  // -------- Persisted plan --------
  const [planName, setPlanName] = useState("");
  const [isSavingPlan, setIsSavingPlan] = useState(false);
  const [savedPlan, setSavedPlan] = useState(null);
  const [savedPlans, setSavedPlans] = useState([]);
  const [isLoadingSavedPlans, setIsLoadingSavedPlans] = useState(false);
  const [deletingPlanId, setDeletingPlanId] = useState(null);

  // -------- UX state --------
  const [isLoadingSpots, setIsLoadingSpots] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // -------- Refs --------
  const mapRef = useRef(null);
  const geoCacheRef = useRef(new Map());

  const defaultCenter = useMemo(() => ({ lat: 10.819655, lng: 106.63331 }), []); // HCM

  const { isLoaded } = useJsApiLoader({
    googleMapsApiKey: env.VITE_GOOGLE_MAPS_API_KEY,
  });

  // ---------- Helpers ----------
  const getSpotById = (id) => spots.find((s) => s.id === id);

  const haversineKm = (a, b) => {
    const R = 6371;
    const toRad = (x) => (x * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);

    const h =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);

    return 2 * R * Math.asin(Math.sqrt(h));
  };

  const orderByNearest = (start, spotList) => {
    const remaining = [...spotList];
    const ordered = [];
    let current = start;

    while (remaining.length) {
      let bestIdx = 0;
      let bestDist = Infinity;

      for (let i = 0; i < remaining.length; i++) {
        const d = haversineKm(current, remaining[i]);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
        }
      }

      const next = remaining.splice(bestIdx, 1)[0];
      ordered.push(next);
      current = next;
    }

    return ordered;
  };

  const focusSpot = (spot) => {
    if (!spot) return;
    const lat = typeof spot.lat === "string" ? parseFloat(spot.lat) : spot.lat;
    const lng = typeof spot.lng === "string" ? parseFloat(spot.lng) : spot.lng;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    setSelectedSpot({ ...spot, lat, lng });
  };

  const focusNextUnvisited = () => {
    const next = planItems.find((x) => !x.visited);
    if (!next) return;
    const spot = getSpotById(next.spotId);
    if (spot) focusSpot(spot);
  };

  // ---------- Shared plan id from URL ----------
  const getPlanIdFromUrl = () => {
    const url = new URL(window.location.href);

    const q1 = url.searchParams.get("plan");
    if (q1) return q1;

    // hash routing (#/?plan=abc)
    const hash = (url.hash || "").startsWith("#") ? url.hash.slice(1) : url.hash || "";
    if (hash.includes("?")) {
      const hashQuery = hash.split("?")[1] || "";
      const hp = new URLSearchParams(hashQuery);
      const q2 = hp.get("plan");
      if (q2) return q2;
    }

    // #/share/<id>
    if (hash.includes("/share/")) {
      const parts = hash.split("/share/");
      if (parts[1]) return decodeURIComponent(parts[1].split("?")[0]);
    }

    // /share/<id>
    if (url.pathname.includes("/share/")) {
      const parts = url.pathname.split("/share/");
      if (parts[1]) return decodeURIComponent(parts[1].split("/")[0]);
    }

    return null;
  };

  useEffect(() => {
    const planId = getPlanIdFromUrl();
    setSharedPlanId(planId);
  }, []);

  const loadSharedPlan = async (planId) => {
    if (!API_BASE || !planId) return;

    setIsLoadingSharedPlan(true);
    try {
      const res = await fetch(API_BASE + "/public/plans/" + encodeURIComponent(planId));
      if (!res.ok) {
        const t = await res.text();
        throw new Error("GET public plan failed: " + res.status + " " + t);
      }

      const data = await res.json();
      setPlanName((data && data.name) || "Shared plan");

      const getSpotId = (x) => {
        if (typeof x?.id === "string" && x.id) return x.id;
        if (typeof x?.spotId === "string" && x.spotId) return x.spotId;
        if (typeof x?.spotID === "string" && x.spotID) return x.spotID;
        if (typeof x?.sk === "string" && x.sk.startsWith("SPOT#")) return x.sk.slice(5);
        return null;
      };

      const toNumber = (v) => {
        if (typeof v === "number") return v;
        if (typeof v === "string") {
          const n = parseFloat(v);
          return Number.isFinite(n) ? n : NaN;
        }
        return NaN;
      };

      const normalizeSpot = (x) => {
        const id = getSpotId(x);
        const lat = toNumber(x?.lat ?? x?.latitude ?? x?.location?.lat);
        const lng = toNumber(x?.lng ?? x?.longitude ?? x?.location?.lng);
        return {
          id,
          spotName: x?.spotName || x?.name || x?.title || "",
          address: x?.address || x?.formattedAddress || "",
          videoUrl: x?.videoUrl || x?.videoURL || x?.url || "",
          lat,
          lng,
        };
      };

      const isValidSpotDetail = (x) =>
        x &&
        typeof x.id === "string" &&
        x.id.trim().length > 0 &&
        typeof x.spotName === "string" &&
        x.spotName.trim().length > 0 &&
        typeof x.address === "string" &&
        x.address.trim().length > 0;

      const isValidSpotForMap = (x) =>
        isValidSpotDetail(x) && Number.isFinite(x.lat) && Number.isFinite(x.lng);

      const rawSpots = Array.isArray(data && data.spots) ? data.spots : [];
      const rawItems = Array.isArray(data && data.items) ? data.items : [];

      // Support both payload shapes:
      // 1) data.spots contains snapshots
      // 2) data.items already include spot snapshot fields
      const derivedFromItems = rawItems.filter(
        (x) => x && (x.spotName || x.name || x.address || x.formattedAddress)
      );

      const merged = [...rawSpots, ...derivedFromItems]
        .map(normalizeSpot)
        .filter(isValidSpotDetail);

      if (merged.length) {
        const byId = new Map();
        for (const s of merged) byId.set(s.id, s);
        const allDetails = Array.from(byId.values());
        const detailsMap = {};
        for (const s of allDetails) detailsMap[s.id] = s;
        setSharedSpotDetailsById(detailsMap);
        setSpots(allDetails.filter(isValidSpotForMap));
      } else {
        setSharedSpotDetailsById({});
        setSpots([]);
      }

      const items = (data && data.items) || [];
      const normalized = items
        .map((x) => ({
          spotId: x.spotId,
          visited: !!x.visited,
          order: typeof x.order === "number" ? x.order : 0,
        }))
        .filter((x) => typeof x.spotId === "string" && x.spotId.length > 0)
        .sort((a, b) => a.order - b.order)
        .map((x) => ({ spotId: x.spotId, visited: x.visited }));

      setPlanItems(normalized);
      setSavedPlan(null);
      setFollowMode(true);
      setSelectedSpot(null);
    } catch (err) {
      console.error(err);
      alert("Failed to load shared plan. Check console.");
    } finally {
      setIsLoadingSharedPlan(false);
    }
  };

  useEffect(() => {
    if (sharedPlanId) loadSharedPlan(sharedPlanId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sharedPlanId, API_BASE]);

  useEffect(() => {
    if (!isPublicView) setSharedSpotDetailsById({});
  }, [isPublicView]);

  // ---------- Load spots (PRIVATE) ----------
  const loadSpotsPrivate = async () => {
    if (!API_BASE) return;

    setIsLoadingSpots(true);
    try {
      const res = await apiFetchAuthed("/spots", { method: "GET" });
      if (!res.ok) throw new Error("HTTP " + res.status);

      const data = await res.json();
      const raw = Array.isArray(data) ? data : (data && data.items) || [];

      const spotsArray = raw
        .map((x) => {
          const lat = typeof x.lat === "string" ? parseFloat(x.lat) : x.lat;
          const lng = typeof x.lng === "string" ? parseFloat(x.lng) : x.lng;
          return { ...x, lat, lng };
        })
        .filter(
          (x) =>
            x &&
            typeof x.id === "string" &&
            typeof x.spotName === "string" &&
            x.spotName.trim().length > 0 &&
            typeof x.address === "string" &&
            x.address.trim().length > 0 &&
            Number.isFinite(x.lat) &&
            Number.isFinite(x.lng)
        );

      setSpots(spotsArray);
    } catch (err) {
      console.error("Load spots failed:", err);
      if (err && err.code === "NO_AUTH") return;
      alert("Failed to load spots (protected route). Please sign in and try again.");
    } finally {
      setIsLoadingSpots(false);
    }
  };

  const openSharedPlan = (planId) => {
    if (!planId) return;
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("plan", planId);
    window.history.pushState({}, "", nextUrl.pathname + nextUrl.search + nextUrl.hash);
    setSharedPlanId(planId);
  };

  const closeSharedPlan = () => {
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.delete("plan");
    window.history.pushState({}, "", nextUrl.pathname + nextUrl.search + nextUrl.hash);
    setSharedPlanId(null);
    setSavedPlan(null);
    setPlanName("");
    setPlanItems([]);
    setSelectedSpot(null);
    setSharedSpotDetailsById({});
  };

  const toAbsoluteShareUrl = (urlLike, planId) => {
    if (typeof urlLike === "string" && urlLike.trim()) {
      const s = urlLike.trim();
      if (s.startsWith("http://") || s.startsWith("https://")) return s;
      if (s.startsWith("/")) return window.location.origin + s;
      return window.location.origin + "/" + s;
    }
    if (planId) return window.location.origin + "/?plan=" + encodeURIComponent(planId);
    return null;
  };

  const deleteSavedPlan = async (planId) => {
    if (!planId) return;
    if (!getIdToken()) {
      alert("Please sign in first.");
      return;
    }

    const ok = window.confirm("Delete this plan?");
    if (!ok) return;

    setDeletingPlanId(planId);
    try {
      const res = await apiFetchAuthed("/plans/" + encodeURIComponent(planId), { method: "DELETE" });
      if (!res.ok) {
        if (res.status === 404) {
          throw new Error("DELETE /plans/{id} is not available on backend yet.");
        }
        const errText = await res.text();
        throw new Error("DELETE /plans failed: " + res.status + " " + errText);
      }

      setSavedPlans((prev) => {
        const next = prev.filter((x) => x.planId !== planId);
        writeSavedPlansCache(next);
        return next;
      });

      if (sharedPlanId === planId) closeSharedPlan();
    } catch (err) {
      console.error(err);
      alert(err && err.message ? err.message : "Failed to delete plan. Check console.");
    } finally {
      setDeletingPlanId(null);
    }
  };

  const loadSavedPlansPrivate = async () => {
    if (!API_BASE) return;

    setIsLoadingSavedPlans(true);
    try {
      const res = await apiFetchAuthed("/plans", { method: "GET" });
      if (!res.ok) {
        // Graceful fallback when endpoint is not deployed yet or auth is not ready.
        if (res.status === 401 || res.status === 403 || res.status === 404) {
          setSavedPlans([]);
          return;
        }
        throw new Error("HTTP " + res.status);
      }

      const data = await res.json();
      const raw =
        (Array.isArray(data) && data) ||
        (Array.isArray(data && data.items) && data.items) ||
        (Array.isArray(data && data.plans) && data.plans) ||
        (Array.isArray(data && data.data && data.data.items) && data.data.items) ||
        (Array.isArray(data && data.data && data.data.plans) && data.data.plans) ||
        [];

      const parsePlanId = (x) => {
        if (typeof x.planId === "string" && x.planId) return x.planId;
        if (typeof x.id === "string" && x.id) return x.id;
        if (typeof x.sk === "string" && x.sk.startsWith("PLAN#")) return x.sk.slice(5);
        return null;
      };

      const plansArray = raw
        .map((x) => ({
          planId: parsePlanId(x),
          name: typeof x.name === "string" && x.name.trim() ? x.name.trim() : "Untitled plan",
          isPublic: !!x.isPublic,
          updatedAt: x.updatedAt || x.createdAt || null,
          shareUrl:
            toAbsoluteShareUrl(
              (typeof x.shareUrl === "string" && x.shareUrl) ||
              (typeof x.publicUrl === "string" && x.publicUrl) ||
              (typeof x.url === "string" && x.url),
              parsePlanId(x)
            ),
        }))
        .filter((x) => typeof x.planId === "string" && x.planId.length > 0);

      setSavedPlans(plansArray);
      writeSavedPlansCache(plansArray);
    } catch (err) {
      console.error("Load saved plans failed:", err);
      // Do not block startup UX with popups when /plans is unavailable or CORS fails.
      setSavedPlans(readSavedPlansCache());
      if (err && err.code === "NO_AUTH") return;
    } finally {
      setIsLoadingSavedPlans(false);
    }
  };

  const loadPlanSpotDetailsFromPrivate = async (spotIds) => {
    if (!API_BASE || !spotIds.length) return;

    setIsLoadingSpots(true);
    try {
      const res = await apiFetchAuthed("/spots", { method: "GET" });
      if (!res.ok) throw new Error("HTTP " + res.status);

      const data = await res.json();
      const raw = Array.isArray(data) ? data : (data && data.items) || [];
      const requestedIds = new Set(spotIds);

      const matched = raw
        .filter((x) => x && typeof x.id === "string" && requestedIds.has(x.id))
        .map((x) => {
          const lat = typeof x.lat === "string" ? parseFloat(x.lat) : x.lat;
          const lng = typeof x.lng === "string" ? parseFloat(x.lng) : x.lng;
          return { ...x, lat, lng };
        })
        .filter(
          (x) =>
            x &&
            typeof x.id === "string" &&
            typeof x.spotName === "string" &&
            x.spotName.trim().length > 0 &&
            typeof x.address === "string" &&
            x.address.trim().length > 0 &&
            Number.isFinite(x.lat) &&
            Number.isFinite(x.lng)
        );

      if (!matched.length) return;

      setSpots((prev) => {
        const byId = new Map(prev.map((x) => [x.id, x]));
        for (const spot of matched) byId.set(spot.id, spot);
        return Array.from(byId.values());
      });
    } catch (err) {
      console.error("Load private spot details for shared plan failed:", err);
      if (err && err.code === "NO_AUTH") return;
      alert("Failed to load spot details for this shared plan. Please sign in and try again.");
    } finally {
      setIsLoadingSpots(false);
    }
  };

  useEffect(() => {
    if (!API_BASE) return;
    if (isPublicView) return;

    // Use id_token consistently because apiFetchAuthed uses id_token.
    if (!getIdToken()) return;

    loadSpotsPrivate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [API_BASE, isPublicView, authUser]);

  useEffect(() => {
    if (!API_BASE) return;
    if (isPublicView) return;
    if (!authUser || !getIdToken()) {
      setSavedPlans([]);
      return;
    }

    // Show last-known list instantly while refreshing from backend.
    const cached = readSavedPlansCache();
    if (Array.isArray(cached) && cached.length) setSavedPlans(cached);
    loadSavedPlansPrivate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [API_BASE, isPublicView, authUser]);

  useEffect(() => {
    if (!API_BASE) return;
    if (!isPublicView || !sharedPlanId) return;
    if (!authUser || !getIdToken()) return;
    if (!planItems.length) return;

    const missingSpotIds = planItems
      .map((x) => x.spotId)
      .filter((spotId) => !getSpotById(spotId));

    if (!missingSpotIds.length) return;
    loadPlanSpotDetailsFromPrivate(missingSpotIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [API_BASE, isPublicView, sharedPlanId, authUser, planItems, spots]);

  // ---------- Pan/zoom AFTER selectedSpot updates ----------
  useEffect(() => {
    if (!selectedSpot || !mapRef.current) return;
    const map = mapRef.current;
    map.panTo({ lat: selectedSpot.lat, lng: selectedSpot.lng });
    map.setZoom(15);
  }, [selectedSpot]);

  // ---------- Follow mode: focus next unvisited ----------
  useEffect(() => {
    if (!followMode) return;
    focusNextUnvisited();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [followMode, planItems]);

  // ---------- Plan actions ----------
  const addToPlan = (spot) => {
    if (isPublicView) return;
    setPlanItems((prev) => {
      if (prev.some((x) => x.spotId === spot.id)) return prev;
      return [...prev, { spotId: spot.id, visited: false }];
    });
  };

  const toggleVisited = (spotId) => {
    setPlanItems((prev) =>
      prev.map((x) => (x.spotId === spotId ? { ...x, visited: !x.visited } : x))
    );
  };

  const removeFromPlan = (spotId) => {
    setPlanItems((prev) => prev.filter((x) => x.spotId !== spotId));
    if (selectedSpot && selectedSpot.id === spotId) setSelectedSpot(null);
  };

  const autoOrderPlan = async () => {
    const getStart = () =>
      new Promise((resolve) => {
        if (!navigator.geolocation) return resolve(defaultCenter);
        navigator.geolocation.getCurrentPosition(
          (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
          () => resolve(defaultCenter),
          { enableHighAccuracy: true, timeout: 6000 }
        );
      });

    const start = await getStart();
    const list = planItems
      .map((x) => getSpotById(x.spotId))
      .filter(Boolean)
      .map((s) => ({ ...s, lat: s.lat, lng: s.lng }));

    const orderedSpots = orderByNearest(start, list);

    setPlanItems((prev) =>
      orderedSpots.map((s) => {
        const found = prev.find((x) => x.spotId === s.id);
        return { spotId: s.id, visited: found ? found.visited : false };
      })
    );
  };

  // ---------- Geocode (server) ----------
  const geocodeAddress = async (rawAddress) => {
    try {
      const key = rawAddress.trim().toLowerCase();
      if (!key) return null;

      if (geoCacheRef.current.has(key)) return geoCacheRef.current.get(key);

      const res = await apiFetchAuthed("/geocode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: rawAddress }),
      });

      if (!res.ok) return null;

      const data = await res.json();
      const result = { lat: data.lat, lng: data.lng, formattedAddress: data.formattedAddress };
      geoCacheRef.current.set(key, result);
      return result;
    } catch (err) {
      console.error("Geocode failed:", err);
      return null;
    }
  };

  // ---------- Create spot (optimistic) ----------
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isPublicView) return;
    if (isSaving) return;

    if (!getIdToken()) {
      alert("Please sign in first.");
      return;
    }

    const name = spotName.trim();
    const url = videoUrl.trim();
    const addr = address.trim();

    if (!name || !url || !addr) {
      alert("Please fill in Video URL, Spot Name, and Address.");
      return;
    }

    setIsSaving(true);

    const optimisticId = "optimistic-" + crypto.randomUUID();
    const optimisticSpot = {
      id: optimisticId,
      spotName: name,
      videoUrl: url,
      address: addr,
      lat: defaultCenter.lat,
      lng: defaultCenter.lng,
      _optimistic: true,
    };

    setSpots((prev) => [optimisticSpot, ...prev]);
    setSelectedSpot(optimisticSpot);

    try {
      const location = await geocodeAddress(addr);
      if (!location) {
        setSpots((prev) => prev.filter((s) => s.id !== optimisticId));
        setSelectedSpot(null);
        alert("Could not find location. Please check the address.");
        return;
      }

      setSpots((prev) =>
        prev.map((s) => (s.id === optimisticId ? { ...s, lat: location.lat, lng: location.lng } : s))
      );
      setSelectedSpot((prev) =>
        prev && prev.id === optimisticId ? { ...prev, lat: location.lat, lng: location.lng } : prev
      );

      const payload = {
        spotName: name,
        videoUrl: url,
        address: addr,
        lat: location.lat,
        lng: location.lng,
      };

      const res = await apiFetchAuthed("/spots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error("POST /spots failed: " + res.status + " " + errText);
      }

      const created = await res.json();

      setSpots((prev) => prev.map((s) => (s.id === optimisticId ? created : s)));
      setSelectedSpot((prev) => (prev && prev.id === optimisticId ? created : prev));

      setSpotName("");
      setVideoUrl("");
      setAddress("");
    } catch (err) {
      console.error(err);
      setSpots((prev) => prev.filter((s) => s.id !== optimisticId));
      setSelectedSpot(null);
      alert("Failed to save spot. Check console.");
    } finally {
      setIsSaving(false);
    }
  };

  const removeSpot = async (spot) => {
    if (isPublicView) return;

    if (!getIdToken()) {
      alert("Please sign in first.");
      return;
    }

    if (spot._optimistic) {
      setSpots((prev) => prev.filter((s) => s.id !== spot.id));
      setPlanItems((prev) => prev.filter((x) => x.spotId !== spot.id));
      if (selectedSpot && selectedSpot.id === spot.id) setSelectedSpot(null);
      return;
    }

    try {
      const res = await apiFetchAuthed("/spots/" + spot.id, { method: "DELETE" });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error("DELETE /spots failed: " + res.status + " " + errText);
      }

      setSpots((prev) => prev.filter((s) => s.id !== spot.id));
      setPlanItems((prev) => prev.filter((x) => x.spotId !== spot.id));
      if (selectedSpot && selectedSpot.id === spot.id) setSelectedSpot(null);
    } catch (err) {
      console.error(err);
      alert("Failed to delete spot. Check console.");
    }
  };

  const unvisitedCount = planItems.filter((x) => !x.visited).length;

  // ---------- Save plan ----------
  const savePlan = async () => {
    if (isPublicView) return;

    if (!getIdToken()) {
      alert("Please sign in first.");
      return;
    }

    if (!API_BASE) {
      alert("Missing API base URL.");
      return;
    }
    if (!planItems.length) {
      alert("Your plan is empty. Add some spots first.");
      return;
    }

    const name = planName.trim() || "My Plan (" + new Date().toLocaleDateString() + ")";

    const payload = {
      name,
      items: planItems.map((x, idx) => {
        const spot = getSpotById(x.spotId) || sharedSpotDetailsById[x.spotId] || {};
        return {
          spotId: x.spotId,
          visited: !!x.visited,
          order: idx,
          spotName: spot.spotName || "",
          address: spot.address || "",
          videoUrl: spot.videoUrl || "",
          lat: Number.isFinite(spot.lat) ? spot.lat : null,
          lng: Number.isFinite(spot.lng) ? spot.lng : null,
        };
      }),
      isPublic: true,
    };

    setIsSavingPlan(true);
    try {
      const res = await apiFetchAuthed("/plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error("POST /plans failed: " + res.status + " " + errText);
      }

      const data = await res.json();
      const planId = data && data.planId;
      const shareUrl = toAbsoluteShareUrl(data && data.shareUrl, planId);

      const saved = { ...data, planId, shareUrl };
      setSavedPlan(saved);
      setSavedPlans((prev) => {
        const next = [
          {
            planId: saved.planId,
            name,
            isPublic: true,
            updatedAt: new Date().toISOString(),
            shareUrl: saved.shareUrl,
          },
          ...prev.filter((x) => x.planId !== saved.planId),
        ];
        writeSavedPlansCache(next);
        return next;
      });
      loadSavedPlansPrivate();

      if (saved && saved.shareUrl && navigator.clipboard && navigator.clipboard.writeText) {
        try {
          await navigator.clipboard.writeText(saved.shareUrl);
        } catch {
          // ignore
        }
      }
    } catch (err) {
      console.error(err);
      alert("Failed to save plan. Check console.");
    } finally {
      setIsSavingPlan(false);
    }
  };

  // ========================
  // UI
  // ========================

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      {/* HEADER */}
      <header className="bg-white border-b sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">AnChoi</h1>
            <p className="text-xs text-gray-500">Eat • Explore • Plan</p>
          </div>

          <div className="text-xs text-gray-500 flex items-center gap-2">
            {sharedPlanId && (
              <span className="text-xs bg-blue-50 text-blue-700 border border-blue-100 px-2 py-1 rounded-full">
                Public view
              </span>
            )}

            <span>{isLoadingSpots ? "Loading…" : `${spots.length} spots`}</span>

            {/* AUTH UI */}
            {authUser ? (
              <div className="flex items-center gap-2">
                {authUser.picture ? (
                  <img
                    src={authUser.picture}
                    alt="avatar"
                    className="w-8 h-8 rounded-full border"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="w-8 h-8 rounded-full border bg-gray-100" />
                )}

                <span className="text-xs text-gray-700 max-w-[180px] truncate">
                  {authUser.name}
                </span>

                <button
                  onClick={logout}
                  className="text-xs px-3 py-2 rounded-xl border bg-gray-50 hover:bg-gray-100"
                  title="Logout"
                >
                  Logout
                </button>
              </div>
            ) : (
              <button
                onClick={startLogin}
                disabled={isAuthLoading}
                className="text-xs px-3 py-2 rounded-xl border bg-gray-50 hover:bg-gray-100 disabled:opacity-60"
                title="Login"
              >
                {isAuthLoading ? "Logging in…" : "Login"}
              </button>
            )}
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        {/* Top: Form + Map */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* FORM */}
          <div className="bg-white rounded-2xl shadow-md p-6 relative">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-2xl font-semibold tracking-tight text-gray-900">Add new spot</h2>
                <p className="text-sm leading-6 text-gray-500 mt-1">
                  Save standout food and hangout places with complete details for planning and sharing.
                </p>
                {isPublicView && (
                  <p className="text-sm text-gray-500 mt-1">
                    You’re viewing a shared plan. Editing is disabled.
                  </p>
                )}
              </div>

            </div>

            <div className="mt-5 mb-5">
              <img
                src={addSpotHero}
                alt="Urban food discovery banner"
                className="w-full h-40 rounded-xl border border-orange-100 object-cover"
              />
            </div>

            <form onSubmit={handleSubmit} className="mt-4 space-y-4">
              <div>
                <label className="text-xs font-medium uppercase tracking-wide text-gray-600">Video URL</label>
                <input
                  type="text"
                  placeholder="https://…"
                  value={videoUrl}
                  onChange={(e) => setVideoUrl(e.target.value)}
                  disabled={isPublicView}
                  className={`mt-1 w-full border rounded-xl p-3 outline-none ${isPublicView
                      ? "bg-gray-100 text-gray-500"
                      : "focus:ring-2 focus:ring-red-400"
                    }`}
                />
              </div>

              <div>
                <label className="text-xs font-medium uppercase tracking-wide text-gray-600">Spot name</label>
                <input
                  type="text"
                  value={spotName}
                  onChange={(e) => setSpotName(e.target.value)}
                  disabled={isPublicView}
                  className={`mt-1 w-full border rounded-xl p-3 outline-none ${isPublicView
                      ? "bg-gray-100 text-gray-500"
                      : "focus:ring-2 focus:ring-red-400"
                    }`}
                />
              </div>

              <div>
                <label className="text-xs font-medium uppercase tracking-wide text-gray-600">Address</label>
                <input
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  disabled={isPublicView}
                  className={`mt-1 w-full border rounded-xl p-3 outline-none ${isPublicView
                      ? "bg-gray-100 text-gray-500"
                      : "focus:ring-2 focus:ring-red-400"
                    }`}
                />
              </div>

              <button
                type="submit"
                disabled={isPublicView || isSaving}
                title={isPublicView ? "Login required" : ""}
                className={`w-full py-3 rounded-xl font-semibold transition ${isPublicView || isSaving
                    ? "bg-gray-300 text-gray-700 cursor-not-allowed"
                    : "bg-red-500 text-white hover:bg-red-600"
                  }`}
              >
                {isPublicView ? "Login to add spots" : isSaving ? "Saving…" : "Save spot"}
              </button>

              {!API_BASE && (
                <p className="text-sm text-red-500">
                  Missing <b>VITE_API_BASE_URL</b>. Set it in env and restart.
                </p>
              )}
            </form>
          </div>

          {/* MAP */}
          <div className="bg-white rounded-2xl shadow-md overflow-hidden">
            <div className="px-5 pt-5 pb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">Map</h2>
            </div>

            {isLoaded ? (
              <div className="px-5 pb-5">
                <div className="rounded-2xl overflow-hidden shadow-sm border">
                  <GoogleMap
                    mapContainerStyle={{ width: "100%", height: "680px" }}
                    center={defaultCenter}
                    zoom={12}
                    onLoad={(map) => {
                      mapRef.current = map;
                    }}
                  >
                    {spots
                      .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng))
                      .map((spot) => (
                        <Marker
                          key={spot.id}
                          position={{ lat: spot.lat, lng: spot.lng }}
                          onClick={() => setSelectedSpot(spot)}
                        />
                      ))}

                    {selectedSpot &&
                      Number.isFinite(selectedSpot.lat) &&
                      Number.isFinite(selectedSpot.lng) && (
                        <InfoWindow
                          position={{ lat: selectedSpot.lat, lng: selectedSpot.lng }}
                          onCloseClick={() => setSelectedSpot(null)}
                        >
                          <div className="text-sm">
                            <div className="flex items-center gap-2">
                              <h3 className="font-bold">{selectedSpot.spotName}</h3>
                              {selectedSpot._optimistic && (
                                <span className="text-xs bg-yellow-100 text-yellow-800 px-2 py-0.5 rounded">
                                  Saving…
                                </span>
                              )}
                            </div>
                            <p className="text-gray-600">{selectedSpot.address}</p>
                            <a
                              href={selectedSpot.videoUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-red-500 underline"
                            >
                              Watch video
                            </a>
                          </div>
                        </InfoWindow>
                      )}
                  </GoogleMap>
                </div>
              </div>
            ) : (
              <div className="p-6">Loading map…</div>
            )}
          </div>
        </div>

        {/* SAVED PLANS */}
        {!isPublicView && (
          <div className="bg-white rounded-2xl shadow-md p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">Saved plans</h2>
              {isLoadingSavedPlans && <span className="text-sm text-gray-500">Loading…</span>}
            </div>

            {!authUser ? (
              <div className="text-sm text-gray-500">Sign in to see your saved plans.</div>
            ) : savedPlans.length === 0 ? (
              <div className="text-sm text-gray-500">No saved plans yet.</div>
            ) : (
              <div className="space-y-2">
                {savedPlans.map((p) => (
                  <div
                    key={p.planId}
                    className="border rounded-xl p-3 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-900 truncate">{p.name}</p>
                      {p.shareUrl && (
                        <a
                          className="text-xs text-red-500 underline break-all"
                          href={p.shareUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {p.shareUrl}
                        </a>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {p.shareUrl && (
                        <button
                          className="text-xs px-3 py-2 rounded-xl border bg-gray-50 hover:bg-gray-100"
                          onClick={async () => {
                            try {
                              await navigator.clipboard.writeText(p.shareUrl);
                              alert("Copied!");
                            } catch {
                              alert("Copy failed. You can copy the link manually.");
                            }
                          }}
                        >
                          Copy link
                        </button>
                      )}
                      <button
                        className="text-xs px-3 py-2 rounded-xl border bg-gray-50 hover:bg-gray-100"
                        onClick={() => openSharedPlan(p.planId)}
                      >
                        Open
                      </button>
                      <button
                        className="text-xs px-3 py-2 rounded-xl border bg-red-50 text-red-600 hover:bg-red-100 disabled:opacity-60"
                        onClick={() => deleteSavedPlan(p.planId)}
                        disabled={deletingPlanId === p.planId}
                      >
                        {deletingPlanId === p.planId ? "Deleting..." : "Delete"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TODAY PLAN */}
        <div className="bg-white rounded-2xl shadow-md p-5 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Today’s plan</h2>
              <p className="text-sm text-gray-500 mt-1">
                {isPublicView
                  ? "Public viewers can optimize, follow, mark done, and remove locally (changes are not saved)."
                  : "Add spots, optimize, then tick them off as you go."}
              </p>
              {sharedPlanId && (
                <div className="mt-2 flex items-center gap-3">
                  <a
                    href={window.location.origin + "/?plan=" + encodeURIComponent(sharedPlanId)}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-red-500 underline"
                  >
                    Share link
                  </a>
                </div>
              )}
            </div>

            <div className="flex flex-col gap-2 items-end">
              <button
                onClick={autoOrderPlan}
                className="text-xs px-3 py-2 rounded-xl border bg-gray-50 hover:bg-gray-100"
                disabled={planItems.length < 2}
                title={planItems.length < 2 ? "Add at least 2 spots" : "Optimize by distance"}
              >
                Optimize
              </button>

              <button
                onClick={closeSharedPlan}
                disabled={!isPublicView}
                className={`text-xs px-3 py-2 rounded-xl border ${isPublicView ? "bg-red-100 text-red-600 hover:bg-red-200" : "bg-gray-200 text-gray-500 cursor-not-allowed"
                  }`}
              >
                Close plan
              </button>
            </div>
          </div>

          {planItems.length === 0 ? (
            <div className="text-sm text-gray-400">
              {isPublicView ? (
                "This shared plan has no items."
              ) : (
                <>
                  No spots in plan yet. Tap <b>Add</b> from your spots list.
                </>
              )}
            </div>
          ) : (
              <div className="space-y-3">
              {planItems.map((item, index) => {
                const spot = getSpotById(item.spotId) || sharedSpotDetailsById[item.spotId];

                if (!spot) {
                  return (
                    <div
                      key={item.spotId}
                      className={`p-4 rounded-2xl border transition ${item.visited ? "bg-green-50 border-green-200" : "bg-gray-50 border-gray-200"
                        }`}
                    >
                      <p className="text-sm font-semibold text-gray-900">
                        {index + 1}. Spot details not loaded
                      </p>
                      <p className="text-xs text-gray-500 mt-1 break-all">spotId: {item.spotId}</p>
                      <p className="text-xs text-gray-400 mt-2">
                        Public view needs the backend to return a spot snapshot in <b>data.spots</b>.
                      </p>
                    </div>
                  );
                }

                return (
                  <div
                    key={item.spotId}
                    onClick={() => focusSpot(spot)}
                    className={`p-4 rounded-2xl border transition cursor-pointer ${item.visited
                        ? "bg-green-50 border-green-200"
                        : "bg-gray-50 border-gray-200 hover:bg-gray-100"
                      }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-900 truncate">
                          {index + 1}. {spot.spotName}
                        </p>
                        <p className="text-xs text-gray-500 mt-1 truncate">{spot.address}</p>

                        <div className="mt-3 flex items-center gap-2">
                          <a
                            href={spot.videoUrl}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-xs text-red-500 underline"
                          >
                            Watch
                          </a>

                          {item.visited && (
                            <span className="text-xs bg-green-600 text-white px-2 py-0.5 rounded-full">
                              Visited
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-col items-end gap-2 shrink-0">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleVisited(item.spotId);
                          }}
                          title={isPublicView ? "Public view: changes are local only" : ""}
                          className={`text-xs px-3 py-2 rounded-xl ${item.visited ? "bg-green-600 text-white" : "bg-white border hover:bg-gray-50"
                            }`}
                        >
                          {item.visited ? "✓" : "Done"}
                        </button>

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            removeFromPlan(item.spotId);
                          }}
                          title={isPublicView ? "Public view: changes are local only" : ""}
                          className="text-xs text-red-500 hover:text-red-600"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Save plan bar */}
          <div className="flex flex-col lg:flex-row gap-3 lg:items-end lg:justify-between border-t pt-4">
            <div className="flex-1">
              <label className="text-xs font-medium text-gray-600">Plan name</label>
              <input
                value={planName}
                onChange={(e) => setPlanName(e.target.value)}
                placeholder="e.g. HCM Food Day 1"
                disabled={isPublicView}
                className={`mt-1 w-full border rounded-xl p-3 outline-none ${isPublicView ? "bg-gray-100 text-gray-500" : "focus:ring-2 focus:ring-red-400"
                  }`}
              />
              {savedPlan?.shareUrl && (
                <div className="mt-2 text-xs text-gray-600">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">Share link:</span>
                    <a
                      className="text-red-500 underline break-all"
                      href={savedPlan.shareUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {savedPlan.shareUrl}
                    </a>
                    <button
                      className="text-xs px-3 py-2 rounded-xl border bg-gray-50 hover:bg-gray-100"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(savedPlan.shareUrl);
                          alert("Copied!");
                        } catch {
                          alert("Copy failed. You can copy the link manually.");
                        }
                      }}
                    >
                      Copy
                    </button>
                  </div>
                </div>
              )}
            </div>

            <button
              onClick={savePlan}
              disabled={isPublicView || isSavingPlan || planItems.length === 0}
              title={isPublicView ? "Login required" : ""}
              className={`w-full lg:w-auto py-3 px-6 rounded-xl font-semibold transition ${isPublicView || isSavingPlan || planItems.length === 0
                  ? "bg-gray-200 text-gray-500 cursor-not-allowed"
                  : "bg-red-500 text-white hover:bg-red-600"
                }`}
            >
              {isPublicView ? "Login to save" : isSavingPlan ? "Saving plan…" : "Save plan"}
            </button>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={focusNextUnvisited}
              disabled={unvisitedCount === 0}
              className={`w-full py-3 rounded-xl font-semibold transition ${unvisitedCount === 0 ? "bg-gray-200 text-gray-500 cursor-not-allowed" : "bg-gray-900 text-white hover:bg-black"
                }`}
            >
              Next unvisited
            </button>

            <button
              onClick={() => {
                if (isPublicView) {
                  if (sharedPlanId) loadSharedPlan(sharedPlanId);
                  return;
                }
                setPlanItems([]);
                setFollowMode(true);
                setSelectedSpot(null);
                setSavedPlan(null);
                setPlanName("");
                setSharedSpotDetailsById({});
              }}
              disabled={!isPublicView && planItems.length === 0}
              title={isPublicView ? "Reset back to the shared plan" : ""}
              className={`w-full py-3 rounded-xl font-semibold transition ${isPublicView || planItems.length === 0
                  ? "bg-gray-200 text-gray-500 cursor-not-allowed"
                  : "border bg-white hover:bg-gray-50"
                }`}
            >
              {isPublicView ? "Reset plan" : "Clear plan"}
            </button>
          </div>
        </div>

        {/* SPOTS */}
        <div className="space-y-3">
          <div className="flex items-end justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Your spots</h2>
              <p className="text-sm text-gray-500">
                Tap a card to focus the map. {isPublicView ? "Public viewers can only view." : "Add it to today’s plan."}
              </p>
            </div>
            {isLoadingSpots && <span className="text-sm text-gray-500">Loading…</span>}
          </div>

          {!authUser && !isPublicView && (
            <div className="bg-white rounded-2xl shadow-md p-4 text-sm text-gray-600">
              This is a protected view. Click <b>Login</b> to load spots.
            </div>
          )}

          {spots.length === 0 ? (
            <div className="text-gray-500 text-center py-10 bg-white rounded-2xl shadow-md">
              No spots yet.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {spots.map((spot) => {
                const inPlan = planItems.some((x) => x.spotId === spot.id);

                return (
                  <div
                    key={spot.id}
                    onClick={() => focusSpot(spot)}
                    className={`bg-white rounded-2xl shadow-md p-5 space-y-3 transition hover:shadow-lg cursor-pointer ${spot._optimistic ? "border border-yellow-200" : ""
                      }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="font-semibold text-gray-900 truncate">{spot.spotName}</h3>
                        <p className="text-sm text-gray-500 mt-1 line-clamp-2">{spot.address}</p>
                      </div>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          addToPlan(spot);
                        }}
                        disabled={isPublicView || inPlan}
                        title={isPublicView ? "Login required" : ""}
                        className={`text-xs px-3 py-2 rounded-full font-medium transition ${isPublicView
                            ? "bg-gray-200 text-gray-500 cursor-not-allowed"
                            : inPlan
                              ? "bg-gray-200 text-gray-500 cursor-not-allowed"
                              : "bg-red-100 text-red-600 hover:bg-red-200"
                          }`}
                      >
                        Add
                      </button>
                    </div>

                    <div className="flex items-center justify-between pt-2">
                      <a
                        href={spot.videoUrl}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-sm text-red-500 underline"
                      >
                        Watch
                      </a>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          removeSpot(spot);
                        }}
                        disabled={isPublicView}
                        title={isPublicView ? "Login required" : ""}
                        className={`text-sm ${isPublicView ? "text-gray-300 cursor-not-allowed" : "text-gray-400 hover:text-red-500"
                          }`}
                      >
                        Delete
                      </button>
                    </div>

                    {spot._optimistic && (
                      <div className="text-xs text-yellow-700 bg-yellow-50 border border-yellow-200 rounded-xl px-3 py-2">
                        Saving…
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <footer className="text-center text-xs text-gray-400 py-6">
          © {new Date().getFullYear()} AnChoi • AWS (Lambda + API Gateway + DynamoDB)
        </footer>
      </div>
    </div>
  );
}

