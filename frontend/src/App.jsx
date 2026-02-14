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

  const mapContainerStyle = { width: "100%", height: "400px" };
  const defaultCenter = { lat: 10.819655, lng: 106.633310 }; // HCM

  const { isLoaded } = useJsApiLoader({
    googleMapsApiKey: env.VITE_GOOGLE_MAPS_API_KEY
  });

  // ✅ Load spots from AWS on start
  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(`${API_BASE}/spots`);
        if (!res.ok) throw new Error(`GET /spots failed: ${res.status}`);
        const data = await res.json();
        setSpots(data);
      } catch (e) {
        console.error(e);
        alert("Failed to load spots from server. Check console.");
      }
    };
    if (API_BASE) load();
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
    <div className="min-h-screen bg-gray-100 flex flex-col items-center p-6">
      <h1 className="text-3xl font-bold text-gray-800 mb-6">
        🍜 AnChoi — Save Food/Fun Spots
      </h1>

      <form onSubmit={handleSubmit} className="bg-white shadow-md rounded-lg p-6 w-full max-w-md space-y-4">
        {/* Video URL */}
        <div>
          <label className="block text-gray-700 font-medium mb-1">Video URL</label>
          <input
            type="text"
            value={videoUrl}
            onChange={(e) => setVideoUrl(e.target.value)}
            className="w-full border border-gray-300 rounded-md p-2 focus:outline-none focus:ring-2 focus:ring-red-400"
          />
        </div>

        {/* Spot Name */}
        <div>
          <label className="block text-gray-700 font-medium mb-1">Spot Name</label>
          <input
            type="text"
            value={spotName}
            onChange={(e) => setSpotName(e.target.value)}
            className="w-full border border-gray-300 rounded-md p-2 focus:outline-none focus:ring-2 focus:ring-red-400"
          />
        </div>

        {/* Address */}
        <div>
          <label className="block text-gray-700 font-medium mb-1">Address</label>
          <input
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            className="w-full border border-gray-300 rounded-md p-2 focus:outline-none focus:ring-2 focus:ring-red-400"
          />
        </div>

        <button type="submit" className="w-full bg-red-500 text-white font-bold py-2 px-4 rounded-md hover:bg-red-600 transition">
          Save Spot
        </button>
      </form>

      {/* MAP */}
      <div className="w-full max-w-4xl mt-6 bg-white shadow-md rounded-lg p-4">
        {isLoaded ? (
          <GoogleMap
            mapContainerStyle={mapContainerStyle}
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
                position={{ lat: selectedSpot.lat, lng: selectedSpot.lng }}
                onCloseClick={() => setSelectedSpot(null)}
              >
                <div className="text-sm">
                  <h3 className="font-bold">{selectedSpot.spotName}</h3>
                  <p className="text-gray-600">{selectedSpot.address}</p>
                  <a href={selectedSpot.videoUrl} target="_blank" className="text-blue-500 underline">
                    Watch video
                  </a>
                </div>
              </InfoWindow>
            )}
          </GoogleMap>
        ) : (
          <div>Loading Map...</div>
        )}
      </div>

      {/* LIST */}
      <div className="w-full max-w-4xl mt-6 bg-white shadow-md rounded-lg p-4">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left">
            <thead>
              <tr>
                <th className="px-4 py-2">Spot Name</th>
                <th className="px-4 py-2">Address</th>
                <th className="px-4 py-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {spots.map((spot) => (
                <tr
                  key={spot.id}
                  onClick={() => {
                    setSelectedSpot(spot);
                    if (mapRef.current) {
                      mapRef.current.panTo({ lat: spot.lat, lng: spot.lng });
                      mapRef.current.setZoom(15);
                    }
                  }}
                  className="cursor-pointer border-t hover:bg-gray-50"
                >
                  <td className="px-4 py-2">
                    <a href={spot.videoUrl} target="_blank" className="text-blue-500 underline" onClick={(e) => e.stopPropagation()}>
                      {spot.spotName}
                    </a>
                  </td>
                  <td className="px-4 py-2">{spot.address}</td>
                  <td className="px-4 py-2">
                    <button
                      className="text-red-500 hover:underline"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeSpot(spot);
                      }}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
              {!spots.length && (
                <tr className="border-t">
                  <td className="px-4 py-4 text-gray-500" colSpan={3}>
                    No spots yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default App;