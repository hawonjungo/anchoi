import './App.css'
import { useState, useRef } from 'react';
import { GoogleMap, Marker, InfoWindow, useJsApiLoader } from "@react-google-maps/api";

function App() {
  const env = import.meta.env;

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

  const handleSubmit = async (e) => {
    e.preventDefault();

    const location = await geocodeAddress(address);
    if (!location) {
      alert("Could not find location on map. Please check the address.");
      return;
    }

    const newSpot = {
      spotName,
      videoUrl,
      address,
      city: extractCity(address),
      lat: location.lat,
      lng: location.lng
    };

    setSpots(prev => [...prev, newSpot]);

    // Pan map safely using ref
    if (mapRef.current) {
      mapRef.current.panTo({ lat: newSpot.lat, lng: newSpot.lng });
      mapRef.current.setZoom(16);
    }

    setSpotName("");
    setVideoUrl("");
    setAddress("");
  };


  const extractCity = (address) => {
    const parts = address.split(",");
    return parts[parts.length - 1].trim();
  };

  const removeSpot = (index) => {
    setSpots(spots.filter((_, i) => i !== index));
    if (selectedSpot && spots[index] === selectedSpot) {
      setSelectedSpot(null);
    }
  };

  const geocodeAddress = async (address) => {
    try {
      const res = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${env.VITE_GOOGLE_MAPS_API_KEY}`
      );
      const data = await res.json();
      if (data.status === "OK") return data.results[0].geometry.location;
      return null;
    } catch (err) {
      console.error("Geocode error:", err);
      return null;
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col items-center p-6">
      <h1 className="text-3xl font-bold text-gray-800 mb-6">
        🍜 AnChoi — Save Food/Fun Spots
      </h1>

      {/* --- FORM --- */}
      <form
        onSubmit={handleSubmit}
        className="bg-white shadow-md rounded-lg p-6 w-full max-w-md space-y-4"
      >
        <div>
          <label className="block text-gray-700 font-medium mb-1">Video URL</label>
          <input
            type="text"
            value={videoUrl}
            onChange={(e) => setVideoUrl(e.target.value)}
            className="w-full border border-gray-300 rounded-md p-2 focus:outline-none focus:ring-2 focus:ring-red-400"
            placeholder="Paste TikTok / Reels / YouTube link"
          />
        </div>

        <div>
          <label className="block text-gray-700 font-medium mb-1">Spot Name</label>
          <input
            type="text"
            value={spotName}
            onChange={(e) => setSpotName(e.target.value)}
            className="w-full border border-gray-300 rounded-md p-2 focus:outline-none focus:ring-2 focus:ring-red-400"
            placeholder="Enter spot name"
          />
        </div>

        <div>
          <label className="block text-gray-700 font-medium mb-1">Address</label>
          <input
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            className="w-full border border-gray-300 rounded-md p-2 focus:outline-none focus:ring-2 focus:ring-red-400"
            placeholder="Enter address"
          />
        </div>

        <button
          type="submit"
          className="w-full bg-red-500 text-white font-bold py-2 px-4 rounded-md hover:bg-red-600 transition"
        >
          Save Spot
        </button>
      </form>

      {/* --- MAP --- */}
      <div className="w-full max-w-4xl mt-6 bg-white shadow-md rounded-lg p-4">
        {isLoaded ? (
          <GoogleMap
            mapContainerStyle={mapContainerStyle}
            center={defaultCenter}
            zoom={12}
            onLoad={(map) => (mapRef.current = map)} // store map instance in ref
          >

            {spots.map((spot, index) => (
              <Marker
                key={index}
                position={{ lat: spot.lat, lng: spot.lng }}
                onClick={() => setSelectedSpot(spot)} // use spot instead of index
              />
            ))}


            {selectedSpot && (
              <InfoWindow
                position={{ lat: selectedSpot.lat, lng: selectedSpot.lng }}
                onCloseClick={() => setSelectedSpot(null)}
              >
                <div className="text-sm">
                  <h3 className="font-bold">{selectedSpot.spotName}</h3>
                  <p className="text-gray-600">{selectedSpot.address}</p> {/* show full address */}
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

      {/* --- SPOTS LIST --- */}
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
              {spots.map((spot, index) => (
                <tr
                  key={index}
                  onClick={() => {
                    setSelectedSpot(spot);
                    if (mapRef.current) {
                      mapRef.current.panTo({ lat: spot.lat, lng: spot.lng });
                      mapRef.current.setZoom(15);
                    }
                  }}

                >
                  <td className="px-4 py-2">
                    <a href={spot.videoUrl} target="_blank" className="text-blue-500 underline">
                      {spot.spotName}
                    </a>
                  </td>
                  <td className="px-4 py-2">{spot.address}</td>
                  <td className="px-4 py-2">
                    <button
                      className="text-red-500 hover:underline"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeSpot(index);
                      }}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default App;
