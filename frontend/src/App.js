import React, { useState } from 'react';
import axios from 'axios';

export default function App() {
  const [url, setUrl] = useState('');
  const [captionText, setCaptionText] = useState('');
  const [captionStyle, setCaptionStyle] = useState({
    fontFamily: 'Arial',
    fontSize: 24,
    color: '#FFFFFF',
    outline: true,
    position: 'bottom',
  });
  const [background, setBackground] = useState('none');
  const [clips, setClips] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const fetchClips = async e => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setClips([]);

    try {
      let videoUrlParam = url.trim();
      // If not a URL, treat as channel ID
      if (!/^https?:\/\//i.test(videoUrlParam)) {
        const { data: vid } = await axios.get(
          `${process.env.REACT_APP_API_BASE}/api/videos`,
          { params: { channelId: videoUrlParam } }
        );
        videoUrlParam = `https://youtu.be/${vid.videoId}`;
      }

      const { data } = await axios.get(
        `${process.env.REACT_APP_API_BASE}/api/clips`,
        {
          params: {
            videoUrl: videoUrlParam,
            captionText,
            fontFamily: captionStyle.fontFamily,
            fontSize: captionStyle.fontSize,
            color: captionStyle.color,
            outline: captionStyle.outline,
            position: captionStyle.position,
            background
          }
        }
      );

      setClips(data.clips);
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-xl mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">AutoClipper-Web</h1>

      <form onSubmit={fetchClips} className="space-y-6">
        {/* URL / Channel ID */}
        <div>
          <label className="block mb-1">YouTube Channel ID or Video URL</label>
          <input
            type="text"
            className="w-full border rounded p-2"
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder="Enter channel ID or full video URL"
            required
          />
        </div>

        {/* Caption Text */}
        <div>
          <label className="block mb-1">Caption Text</label>
          <input
            type="text"
            className="w-full border rounded p-2"
            value={captionText}
            onChange={e => setCaptionText(e.target.value)}
            placeholder="Enter the caption to display"
            required
          />
        </div>

        {/* Caption Styling */}
        <fieldset className="border rounded p-4">
          <legend className="px-2 font-semibold">Caption Style</legend>
          <div className="grid grid-cols-2 gap-4">
            {/* font family */}
            <div>
              <label className="block mb-1">Font Family</label>
              <select
                value={captionStyle.fontFamily}
                onChange={e =>
                  setCaptionStyle({ ...captionStyle, fontFamily: e.target.value })
                }
                className="border rounded p-1 w-full"
              >
                {['Arial','Courier New','Georgia','Impact','Times New Roman'].map(f => (
                  <option key={f}>{f}</option>
                ))}
              </select>
            </div>
            {/* font size */}
            <div>
              <label className="block mb-1">Font Size</label>
              <input
                type="number"
                min={12}
                value={captionStyle.fontSize}
                onChange={e =>
                  setCaptionStyle({ ...captionStyle, fontSize: +e.target.value })
                }
                className="border rounded p-1 w-full"
              />
            </div>
            {/* color */}
            <div>
              <label className="block mb-1">Color</label>
              <input
                type="color"
                value={captionStyle.color}
                onChange={e =>
                  setCaptionStyle({ ...captionStyle, color: e.target.value })
                }
                className="border rounded p-1"
              />
            </div>
            {/* outline */}
            <div className="flex items-center">
              <input
                type="checkbox"
                checked={captionStyle.outline}
                onChange={e =>
                  setCaptionStyle({ ...captionStyle, outline: e.target.checked })
                }
                className="mr-2"
              />
              <label>Outline</label>
            </div>
            {/* position */}
            <div className="col-span-2">
              <label className="block mb-1">Position</label>
              <select
                value={captionStyle.position}
                onChange={e =>
                  setCaptionStyle({ ...captionStyle, position: e.target.value })
                }
                className="border rounded p-1 w-full"
              >
                {['bottom','center','top'].map(pos => (
                  <option key={pos}>{pos}</option>
                ))}
              </select>
            </div>
          </div>
        </fieldset>

        {/* Background Overlay */}
        <fieldset className="border rounded p-4">
          <legend className="px-2 font-semibold">Background Overlay</legend>
          <select
            value={background}
            onChange={e => setBackground(e.target.value)}
            className="border rounded p-2 w-full"
          >
            <option value="none">None</option>
            <option value="minecraft">Minecraft Parkour</option>
            <option value="gta5">GTA5 Gameplay</option>
            <option value="rocketleague">Rocket League</option>
          </select>
        </fieldset>

        <button
          type="submit"
          disabled={loading}
          className="bg-blue-600 text-white px-4 py-2 rounded w-full disabled:opacity-50"
        >
          {loading ? 'Processing…' : 'Fetch Clips'}
        </button>
      </form>

      {error && <p className="mt-4 text-red-500">{error}</p>}

      {clips.length > 0 && (
        <div className="mt-6 space-y-4">
          <h2 className="text-xl font-semibold">Generated Clips</h2>
          <ul className="space-y-2">
            {clips.map((c,i) => (
              <li key={i} className="border rounded p-2">
                <video
                  src={`${process.env.REACT_APP_API_BASE}${c.url}`}
                  controls
                  className="w-full rounded"
                />
                <p className="mt-1 text-gray-600 text-sm">
                  {c.start}s – {c.end}s
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
);
}
