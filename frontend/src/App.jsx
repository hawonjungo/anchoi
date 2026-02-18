import "./App.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { GoogleMap, Marker, InfoWindow, useJsApiLoader } from "@react-google-maps/api";

export default function App() {
  const env = import.meta.env;
  const API_BASE = env.VITE_API_BASE_URL;

  // -------- Form state --------
  const [videoUrl, setVideoUrl] = useState("");
  const [spotName, setSpotName] = useState("");
  const [address, setAddress] = useState("");

  // -------- Data state --------
  const [spots, setSpots] = useState([]);
  const [selectedSpot, setSelectedSpot] = useState(null);

  // -------- Phase 2: Plan state --------
  // planItems: [{ spotId: string, visited: boolean }]
  const [planItems, setPlanItems] = useState([]);
  const [followMode, setFollowMode] = useState(false);

  // -------- Phase 2.5: Persisted plan (Step 1) --------
  const [planName, setPlanName] = useState("");
  const [isSavingPlan, setIsSavingPlan] = useState(false);
  const [savedPlan, setSavedPlan] = useState(null); // { planId, shareUrl }

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

  // Haversine distance (km)
  const haversineKm = (a, b) => {
    const R = 6371;
    const toRad = (x) => (x * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);

    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

    return 2 * R * Math.asin(Math.sqrt(h));
  };

  // Nearest-neighbor ordering
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
    // Guard against bad coordinates (prevents Google Maps 'lat is not a number')
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

  // ---------- Load spots ----------
  useEffect(() => {
    if (!API_BASE) return;

    const loadSpots = async () => {
      setIsLoadingSpots(true);
      try {
        const res = await fetch(`${API_BASE}/spots`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data = await res.json();
        const raw = Array.isArray(data) ? data : data.items ?? [];

        // IMPORTANT: Your /spots endpoint may return non-spot items (e.g., PLAN rows).
        // Also DynamoDB sometimes stores numbers as strings depending on your writer.
        // So we sanitize + filter here to avoid empty cards and map errors.
        const spotsArray = raw
          .map((x) => {
            const lat = typeof x?.lat === "string" ? parseFloat(x.lat) : x?.lat;
            const lng = typeof x?.lng === "string" ? parseFloat(x.lng) : x?.lng;
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
        alert("Failed to load spots from server. Check console.");
      } finally {
        setIsLoadingSpots(false);
      }
    };

    loadSpots();
  }, [API_BASE]);

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
    if (selectedSpot?.id === spotId) setSelectedSpot(null);
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

    const planSpots = planItems.map((x) => getSpotById(x.spotId)).filter(Boolean);
    if (planSpots.length <= 1) return;

    const ordered = orderByNearest(start, planSpots);

    setPlanItems((prev) => {
      const visitedMap = new Map(prev.map((x) => [x.spotId, x.visited]));
      return ordered.map((s) => ({ spotId: s.id, visited: visitedMap.get(s.id) ?? false }));
    });
  };

  // ---------- Geocode (server) ----------
  const geocodeAddress = async (rawAddress) => {
    try {
      const key = rawAddress.trim().toLowerCase();
      if (!key) return null;

      if (geoCacheRef.current.has(key)) return geoCacheRef.current.get(key);

      const res = await fetch(`${API_BASE}/geocode`, {
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
    if (isSaving) return;

    const name = spotName.trim();
    const url = videoUrl.trim();
    const addr = address.trim();

    if (!name || !url || !addr) {
      alert("Please fill in Video URL, Spot Name, and Address.");
      return;
    }

    setIsSaving(true);

    const optimisticId = `optimistic-${crypto.randomUUID()}`;
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

      // update optimistic coords
      setSpots((prev) =>
        prev.map((s) => (s.id === optimisticId ? { ...s, lat: location.lat, lng: location.lng } : s))
      );
      setSelectedSpot((prev) =>
        prev?.id === optimisticId ? { ...prev, lat: location.lat, lng: location.lng } : prev
      );

      const payload = {
        spotName: name,
        videoUrl: url,
        address: addr,
        lat: location.lat,
        lng: location.lng,
      };

      const res = await fetch(`${API_BASE}/spots`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`POST /spots failed: ${res.status} ${errText}`);
      }

      const created = await res.json();

      setSpots((prev) => prev.map((s) => (s.id === optimisticId ? created : s)));
      setSelectedSpot((prev) => (prev?.id === optimisticId ? created : prev));

      // Optional: auto-add to plan
      // addToPlan(created);

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
    if (spot._optimistic) {
      setSpots((prev) => prev.filter((s) => s.id !== spot.id));
      setPlanItems((prev) => prev.filter((x) => x.spotId !== spot.id));
      if (selectedSpot?.id === spot.id) setSelectedSpot(null);
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/spots/${spot.id}`, { method: "DELETE" });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`DELETE /spots failed: ${res.status} ${errText}`);
      }

      setSpots((prev) => prev.filter((s) => s.id !== spot.id));
      setPlanItems((prev) => prev.filter((x) => x.spotId !== spot.id));
      if (selectedSpot?.id === spot.id) setSelectedSpot(null);
    } catch (err) {
      console.error(err);
      alert("Failed to delete spot. Check console.");
    }
  };

  const unvisitedCount = planItems.filter((x) => !x.visited).length;

  // ---------- Save plan (Step 1) ----------
  const savePlan = async () => {
    if (!API_BASE) {
      alert("Missing API base URL.");
      return;
    }
    if (!planItems.length) {
      alert("Your plan is empty. Add some spots first.");
      return;
    }

    const name = planName.trim() || `My Plan (${new Date().toLocaleDateString()})`;

    const payload = {
      name,
      items: planItems.map((x, idx) => ({
        spotId: x.spotId,
        visited: !!x.visited,
        order: idx,
      })),
      isPublic: true,
    };

    setIsSavingPlan(true);
    try {
      const res = await fetch(`${API_BASE}/plans`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`POST /plans failed: ${res.status} ${errText}`);
      }

      const data = await res.json();
      setSavedPlan(data);

      if (data?.shareUrl && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(data.shareUrl);
      }
    } catch (err) {
      console.error(err);
      alert("Failed to save plan. Check console.");
    } finally {
      setIsSavingPlan(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      {/* HEADER */}
      <header className="bg-white border-b sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">AnChoi</h1>
            <p className="text-xs text-gray-500">Eat • Explore • Plan</p>
          </div>
          <div className="text-xs text-gray-500">
            {isLoadingSpots ? "Loading…" : `${spots.length} spots`}
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        {/* Top: Form + Map */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* FORM */}
          <div className="bg-white rounded-2xl shadow-md p-5">
            <h2 className="text-lg font-semibold text-gray-900">Add new spot</h2>
            <form onSubmit={handleSubmit} className="mt-4 space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-600">Video URL</label>
                <input
                  type="text"
                  placeholder="https://…"
                  value={videoUrl}
                  onChange={(e) => setVideoUrl(e.target.value)}
                  className="mt-1 w-full border rounded-xl p-3 focus:ring-2 focus:ring-red-400 outline-none"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-gray-600">Spot name</label>
                <input
                  type="text"
                  value={spotName}
                  onChange={(e) => setSpotName(e.target.value)}
                  className="mt-1 w-full border rounded-xl p-3 focus:ring-2 focus:ring-red-400 outline-none"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-gray-600">Address</label>
                <input
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className="mt-1 w-full border rounded-xl p-3 focus:ring-2 focus:ring-red-400 outline-none"
                />
              </div>

              <button
                type="submit"
                disabled={isSaving}
                className={`w-full py-3 rounded-xl font-semibold transition ${
                  isSaving ? "bg-gray-300 text-gray-700 cursor-not-allowed" : "bg-red-500 text-white hover:bg-red-600"
                }`}
              >
                {isSaving ? "Saving…" : "Save spot"}
              </button>

              {!API_BASE && (
                <p className="text-sm text-red-500">
                  Missing <b>VITE_API_BASE_URL</b>. Set it in GitHub Secrets and redeploy.
                </p>
              )}
            </form>
          </div>

          {/* MAP */}
          <div className="bg-white rounded-2xl shadow-md overflow-hidden">
            <div className="px-5 pt-5 pb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">Map</h2>
              {followMode && (
                <span className="text-xs bg-red-100 text-red-600 px-2 py-1 rounded-full">Follow mode</span>
              )}
            </div>

            {isLoaded ? (
              <div className="px-5 pb-5">
                <div className="rounded-2xl overflow-hidden shadow-sm border">
                  <GoogleMap
                    mapContainerStyle={{ width: "100%", height: "320px" }}
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

                    {selectedSpot && Number.isFinite(selectedSpot.lat) && Number.isFinite(selectedSpot.lng) && (
                      <InfoWindow
                        position={{ lat: selectedSpot.lat, lng: selectedSpot.lng }}
                        onCloseClick={() => setSelectedSpot(null)}
                      >
                        <div className="text-sm">
                          <div className="flex items-center gap-2">
                            <h3 className="font-bold">{selectedSpot.spotName}</h3>
                            {selectedSpot._optimistic && (
                              <span className="text-xs bg-yellow-100 text-yellow-800 px-2 py-0.5 rounded">Saving…</span>
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

        {/* TODAY PLAN */}
        <div className="bg-white rounded-2xl shadow-md p-5 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Today’s plan</h2>
              <p className="text-sm text-gray-500 mt-1">Add spots, optimize, then tick them off as you go.</p>
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
                onClick={() => setFollowMode((v) => !v)}
                className={`text-xs px-3 py-2 rounded-xl transition ${
                  followMode ? "bg-red-500 text-white" : "border bg-gray-50 hover:bg-gray-100"
                }`}
              >
                {followMode ? "Following" : "Follow"}
              </button>
            </div>
          </div>

          {planItems.length === 0 ? (
            <div className="text-sm text-gray-400">No spots in plan yet. Tap <b>Add</b> from your spots list.</div>
          ) : (
            <div className="space-y-3">
              {planItems.map((item, index) => {
                const spot = getSpotById(item.spotId);
                if (!spot) return null;

                return (
                  <div
                    key={item.spotId}
                    onClick={() => focusSpot(spot)}
                    className={`p-4 rounded-2xl border transition cursor-pointer ${
                      item.visited ? "bg-green-50 border-green-200" : "bg-gray-50 border-gray-200 hover:bg-gray-100"
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
                            <span className="text-xs bg-green-600 text-white px-2 py-0.5 rounded-full">Visited</span>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-col items-end gap-2 shrink-0">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleVisited(item.spotId);
                          }}
                          className={`text-xs px-3 py-2 rounded-xl ${
                            item.visited ? "bg-green-600 text-white" : "bg-white border hover:bg-gray-50"
                          }`}
                        >
                          {item.visited ? "✓" : "Done"}
                        </button>

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            removeFromPlan(item.spotId);
                          }}
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
                className="mt-1 w-full border rounded-xl p-3 focus:ring-2 focus:ring-red-400 outline-none"
              />
              {savedPlan?.shareUrl && (
                <div className="mt-2 text-xs text-gray-600">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">Share link:</span>
                    <a className="text-red-500 underline break-all" href={savedPlan.shareUrl} target="_blank" rel="noreferrer">
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
              disabled={isSavingPlan || planItems.length === 0}
              className={`w-full lg:w-auto py-3 px-6 rounded-xl font-semibold transition ${
                isSavingPlan || planItems.length === 0
                  ? "bg-gray-200 text-gray-500 cursor-not-allowed"
                  : "bg-red-500 text-white hover:bg-red-600"
              }`}
            >
              {isSavingPlan ? "Saving plan…" : "Save plan"}
            </button>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={focusNextUnvisited}
              disabled={unvisitedCount === 0}
              className={`w-full py-3 rounded-xl font-semibold transition ${
                unvisitedCount === 0 ? "bg-gray-200 text-gray-500 cursor-not-allowed" : "bg-gray-900 text-white hover:bg-black"
              }`}
            >
              Next unvisited
            </button>

            <button
              onClick={() => {
                setPlanItems([]);
                setFollowMode(false);
                setSelectedSpot(null);
                setSavedPlan(null);
                setPlanName("");
              }}
              disabled={planItems.length === 0}
              className={`w-full py-3 rounded-xl font-semibold transition ${
                planItems.length === 0 ? "bg-gray-200 text-gray-500 cursor-not-allowed" : "border bg-white hover:bg-gray-50"
              }`}
            >
              Clear plan
            </button>
          </div>
        </div>

        {/* SPOTS */}
        <div className="space-y-3">
          <div className="flex items-end justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Your spots</h2>
              <p className="text-sm text-gray-500">Tap a card to focus the map. Add it to today’s plan.</p>
            </div>
            {isLoadingSpots && <span className="text-sm text-gray-500">Loading…</span>}
          </div>

          {spots.length === 0 ? (
            <div className="text-gray-500 text-center py-10 bg-white rounded-2xl shadow-md">No spots yet.</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {spots.map((spot) => {
                const inPlan = planItems.some((x) => x.spotId === spot.id);

                return (
                  <div
                    key={spot.id}
                    onClick={() => focusSpot(spot)}
                    className={`bg-white rounded-2xl shadow-md p-5 space-y-3 transition hover:shadow-lg cursor-pointer ${
                      spot._optimistic ? "border border-yellow-200" : ""
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
                        disabled={inPlan}
                        className={`text-xs px-3 py-2 rounded-full font-medium transition ${
                          inPlan ? "bg-gray-200 text-gray-500 cursor-not-allowed" : "bg-red-100 text-red-600 hover:bg-red-200"
                        }`}
                      >
                        {inPlan ? "Added" : "Add"}
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
                        className="text-sm text-gray-400 hover:text-red-500"
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
