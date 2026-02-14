import './App.css'
import { useEffect, useState, useRef } from 'react';
import { GoogleMap, Marker, InfoWindow, useJsApiLoader } from "@react-google-maps/api";

function App() {
  const env = import.meta.env;
  const API_BASE = env.VITE_API_BASE_URL;

  const [videoUrl, setVideoUrl] = useState('');
  const [spotName, setSpotName] = useState('');
  const [address, setAddress] = useState('');
  const [spots, setSpots] = useState([]);
  const [selectedSpot, setSelectedSpot] = useState(null);
  const mapRef = useRef(null);

  const mapContainerStyle = { width: "100%", height: window.innerWidth < 768 ? "300px" : "400px" };
  const defaultCenter = { lat: 10.819655, lng: 106.633310 }; // HCM

  const { isLoaded } = useJsApiLoader({
    googleMapsApiKey: env.VITE_GOOGLE_MAPS_API_KEY
  });

  // ✅ Load spots from AWS on start
  useEffect(() => {
    const loadSpots = async () => {
      try {
        const res = await fetch(`${API_BASE}/spots`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data = await res.json();

        // ✅ support both formats
        const spotsArray = Array.isArray(data) ? data : (data.items ?? []);
        setSpots(spotsArray);
      } catch (err) {
        console.error("Load spots failed:", err);
        alert("Failed to load spots from server. Check console.");
      }
    };
    if (API_BASE) loadSpots();
  }, [API_BASE]);

  const geocodeAddress = async (address) => {
    const res = await fetch(`${API_BASE}/geocode`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address }),
    });

    if (!res.ok) return null;

    const data = await res.json();

    return {
      lat: data.lat,
      lng: data.lng,
      formattedAddress: data.formattedAddress,
    };
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    const location = await geocodeAddress(address);

    if (!location) {
      alert("Could not find location.");
      return;
    }

    try {
      const payload = {
        spotName,
        videoUrl,
        address,
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
      setSpots(prev => [...prev, created]);

      // Pan map
      if (mapRef.current) {
        mapRef.current.panTo({ lat: created.lat, lng: created.lng });
        mapRef.current.setZoom(16);
      }

      setSpotName("");
      setVideoUrl("");
      setAddress("");
    } catch (err) {
      console.error(err);
      alert("Failed to save spot. Check console.");
    }
  };

  const removeSpot = async (spot) => {
    try {
      const res = await fetch(`${API_BASE}/spots/${spot.id}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`DELETE /spots failed: ${res.status} ${errText}`);
      }

      setSpots(prev => prev.filter(s => s.id !== spot.id));
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
        <h1 className="text-xl md:text-2xl font-bold text-gray-800">
          🍜 AnChoi
        </h1>
        <span className="text-sm text-gray-500">
          Save Food & Fun Spots
        </span>
      </div>
    </header>

    <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">

      {/* FORM + MAP (Responsive layout) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* ADD SPOT CARD */}
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
              className="w-full bg-red-500 hover:bg-red-600 text-white py-3 rounded-lg font-semibold transition"
            >
              Save Spot
            </button>
          </form>
        </div>

        {/* MAP CARD */}
        <div className="bg-white rounded-xl shadow-md overflow-hidden">
          {isLoaded ? (
            <GoogleMap
              mapContainerStyle={{ width: "100%", height: "350px" }}
              center={defaultCenter}
              zoom={12}
              onLoad={(map) => (mapRef.current = map)}
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
                  position={{
                    lat: selectedSpot.lat,
                    lng: selectedSpot.lng,
                  }}
                  onCloseClick={() => setSelectedSpot(null)}
                >
                  <div>
                    <h3 className="font-bold">
                      {selectedSpot.spotName}
                    </h3>
                    <p className="text-sm text-gray-500">
                      {selectedSpot.address}
                    </p>
                  </div>
                </InfoWindow>
              )}
            </GoogleMap>
          ) : (
            <div className="p-6">Loading map...</div>
          )}
        </div>

      </div>

      {/* SPOT LIST */}
      <div>
        <h2 className="text-lg font-semibold mb-4">Your Spots</h2>

        {spots.length === 0 ? (
          <div className="text-gray-500 text-center py-10">
            No spots yet.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {spots.map((spot) => (
              <div
                key={spot.id}
                className="bg-white rounded-xl shadow-md p-4 hover:shadow-lg transition cursor-pointer"
                onClick={() => {
                  setSelectedSpot(spot);
                  if (mapRef.current) {
                    mapRef.current.panTo({
                      lat: spot.lat,
                      lng: spot.lng,
                    });
                    mapRef.current.setZoom(15);
                  }
                }}
              >
                <h3 className="font-semibold text-gray-800">
                  {spot.spotName}
                </h3>

                <p className="text-sm text-gray-500 mt-1">
                  {spot.address}
                </p>

                <div className="flex justify-between items-center mt-4">
                  <a
                    href={spot.videoUrl}
                    target="_blank"
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

    </div>
  </div>
);
}

export default App;
