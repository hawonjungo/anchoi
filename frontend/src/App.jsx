import "./App.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { GoogleMap, Marker, InfoWindow, useJsApiLoader } from "@react-google-maps/api";

function App() {
  const env = import.meta.env;
  const API_BASE = env.VITE_API_BASE_URL;

  const [videoUrl, setVideoUrl] = useState("");
  const [spotName, setSpotName] = useState("");
  const [address, setAddress] = useState("");

  const [spots, setSpots] = useState([]);
  const [selectedSpot, setSelectedSpot] = useState(null);

  const [isLoadingSpots, setIsLoadingSpots] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const mapRef = useRef(null);

  // ✅ Cache geocode results in memory (address -> {lat,lng,formattedAddress})
  const geoCacheRef = useRef(new Map());

  const defaultCenter = useMemo(() => ({ lat: 10.819655, lng: 106.63331 }), []); // HCM

  const { isLoaded } = useJsApiLoader({
    googleMapsApiKey: env.VITE_GOOGLE_MAPS_API_KEY,
  });

  // ✅ Load spots on start
  useEffect(() => {
    if (!API_BASE) return;

    const loadSpots = async () => {
      setIsLoadingSpots(true);
      try {
        const res = await fetch(`${API_BASE}/spots`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data = await res.json();
        const spotsArray = Array.isArray(data) ? data : data.items ?? [];
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

  // ✅ Pan/zoom AFTER selectedSpot changes (fix double click)
  useEffect(() => {
    if (!selectedSpot || !mapRef.current) return;
    const map = mapRef.current;
    map.panTo({ lat: selectedSpot.lat, lng: selectedSpot.lng });
    map.setZoom(15);
  }, [selectedSpot]);

  const geocodeAddress = async (rawAddress) => {
    try {
      const key = rawAddress.trim().toLowerCase();
      if (!key) return null;

      // ✅ cache hit
      if (geoCacheRef.current.has(key)) return geoCacheRef.current.get(key);

      const res = await fetch(`${API_BASE}/geocode`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: rawAddress }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        console.error("Geocode failed:", res.status, text);
        return null;
      }

      const data = await res.json();
      const result = {
        lat: data.lat,
        lng: data.lng,
        formattedAddress: data.formattedAddress,
      };

      geoCacheRef.current.set(key, result);
      return result;
    } catch (err) {
      console.error("Geocode failed:", err);
      return null;
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (isSaving) return; // prevent double submit

    const name = spotName.trim();
    const url = videoUrl.trim();
    const addr = address.trim();

    if (!name || !url || !addr) {
      alert("Please fill in Video URL, Spot Name, and Address.");
      return;
    }

    setIsSaving(true);

    // ✅ Optimistic spot shows instantly
    const optimisticId = `optimistic-${crypto.randomUUID()}`;
    const optimisticSpot = {
      id: optimisticId,
      spotName: name,
      videoUrl: url,
      address: addr,
      lat: defaultCenter.lat, // temp; will update after geocode
      lng: defaultCenter.lng,
      _optimistic: true,
    };

    setSpots((prev) => [optimisticSpot, ...prev]);
    setSelectedSpot(optimisticSpot);

    try {
      // 1) geocode
      const location = await geocodeAddress(addr);
      if (!location) {
        // remove optimistic
        setSpots((prev) => prev.filter((s) => s.id !== optimisticId));
        setSelectedSpot(null);
        alert("Could not find location. Please check the address.");
        return;
      }

      // Update optimistic marker to real coords immediately (still optimistic)
      setSpots((prev) =>
        prev.map((s) =>
          s.id === optimisticId
            ? { ...s, lat: location.lat, lng: location.lng }
            : s
        )
      );
      setSelectedSpot((prev) =>
        prev?.id === optimisticId
          ? { ...prev, lat: location.lat, lng: location.lng }
          : prev
      );

      // 2) save to DB
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

      // Replace optimistic with real created item
      setSpots((prev) => prev.map((s) => (s.id === optimisticId ? created : s)));
      setSelectedSpot((prev) => (prev?.id === optimisticId ? created : prev));

      // Clear inputs
      setSpotName("");
      setVideoUrl("");
      setAddress("");
    } catch (err) {
      console.error(err);
      // Remove optimistic if request failed
      setSpots((prev) => prev.filter((s) => s.id !== optimisticId));
      setSelectedSpot(null);
      alert("Failed to save spot. Check console.");
    } finally {
      setIsSaving(false);
    }
  };

  const removeSpot = async (spot) => {
    // If it's optimistic, just remove locally
    if (spot._optimistic) {
      setSpots((prev) => prev.filter((s) => s.id !== spot.id));
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
      if (selectedSpot?.id === spot.id) setSelectedSpot(null);
    } catch (err) {
      console.error(err);
      alert("Failed to delete spot. Check console.");
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* HEADER */}
      <header className="bg-white shadow-sm sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-4 flex justify-between items-center">
          <h1 className="text-xl md:text-2xl font-bold text-gray-800">🍜 AnChoi</h1>
          <span className="text-sm text-gray-500">Save Food & Fun Spots</span>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        {/* FORM + MAP */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* FORM */}
          <div className="bg-white rounded-xl shadow-md p-6">
            <h2 className="text-lg font-semibold mb-4">Add New Spot</h2>

            <form onSubmit={handleSubmit} className="space-y-4">
              <input
                type="text"
                placeholder="Video URL"
                value={videoUrl}
                onChange={(e) => setVideoUrl(e.target.value)}
                className="w-full border rounded-lg p-3 focus:ring-2 focus:ring-red-400 outline-none"
              />

              <input
                type="text"
                placeholder="Spot Name"
                value={spotName}
                onChange={(e) => setSpotName(e.target.value)}
                className="w-full border rounded-lg p-3 focus:ring-2 focus:ring-red-400 outline-none"
              />

              <input
                type="text"
                placeholder="Address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className="w-full border rounded-lg p-3 focus:ring-2 focus:ring-red-400 outline-none"
              />

              <button
                type="submit"
                disabled={isSaving}
                className={`w-full py-3 rounded-lg font-semibold transition ${
                  isSaving
                    ? "bg-gray-400 cursor-not-allowed text-white"
                    : "bg-red-500 hover:bg-red-600 text-white"
                }`}
              >
                {isSaving ? "Saving..." : "Save Spot"}
              </button>
            </form>

            {!API_BASE && (
              <p className="mt-4 text-sm text-red-500">
                Missing VITE_API_BASE_URL. Set it in GitHub Secrets and redeploy.
              </p>
            )}
          </div>

          {/* MAP */}
          <div className="bg-white rounded-xl shadow-md overflow-hidden">
            {isLoaded ? (
              <GoogleMap
                mapContainerStyle={{ width: "100%", height: "350px" }}
                center={defaultCenter}
                zoom={12}
                onLoad={(map) => {
                  mapRef.current = map;
                }}
              >
                {spots.map((spot) => (
                  <Marker
                    key={spot.id}
                    position={{ lat: spot.lat, lng: spot.lng }}
                    onClick={() => setSelectedSpot(spot)}
                  />
                ))}

                {selectedSpot && (
                  <InfoWindow
                    position={{ lat: selectedSpot.lat, lng: selectedSpot.lng }}
                    onCloseClick={() => setSelectedSpot(null)}
                  >
                    <div className="text-sm">
                      <div className="flex items-center gap-2">
                        <h3 className="font-bold">{selectedSpot.spotName}</h3>
                        {selectedSpot._optimistic && (
                          <span className="text-xs bg-yellow-100 text-yellow-800 px-2 py-0.5 rounded">
                            Saving...
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
            ) : (
              <div className="p-6">Loading map...</div>
            )}
          </div>
        </div>

        {/* LIST */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Your Spots</h2>
            {isLoadingSpots && <span className="text-sm text-gray-500">Loading…</span>}
          </div>

          {spots.length === 0 ? (
            <div className="text-gray-500 text-center py-10">No spots yet.</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {spots.map((spot) => (
                <div
                  key={spot.id}
                  className={`bg-white rounded-xl shadow-md p-4 hover:shadow-lg transition cursor-pointer ${
                    spot._optimistic ? "border border-yellow-200" : ""
                  }`}
                  onClick={() => setSelectedSpot(spot)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="font-semibold text-gray-800">{spot.spotName}</h3>
                    {spot._optimistic && (
                      <span className="text-xs bg-yellow-100 text-yellow-800 px-2 py-0.5 rounded">
                        Saving…
                      </span>
                    )}
                  </div>

                  <p className="text-sm text-gray-500 mt-1">{spot.address}</p>

                  <div className="flex justify-between items-center mt-4">
                    <a
                      href={spot.videoUrl}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="text-red-500 text-sm font-medium"
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
                </div>
              ))}
            </div>
          )}
        </div>

        {/* FOOTER */}
        <footer className="text-center text-xs text-gray-400 py-6">
          © {new Date().getFullYear()} AnChoi • AWS (Lambda + API Gateway + DynamoDB)
        </footer>
      </div>
    </div>
  );
}

export default App;