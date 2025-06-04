// backend/index.js
require('dotenv').config();
console.log('OpenAI key loaded:', !!process.env.OPENAI_API_KEY);

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const ytdl = require('ytdl-core');
const ffmpeg = require('fluent-ffmpeg');
const ytdlp = require('yt-dlp-exec');
const OpenAI = require('openai');
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseOptions: { timeout: 120_000 }
});

ffmpeg.setFfmpegPath(require('ffmpeg-static'));

const app = express();
app.use(cors());
app.use(express.json());

const clipsDir = path.join(__dirname, 'clips');
if (!fs.existsSync(clipsDir)) fs.mkdirSync(clipsDir);
app.use('/clips', express.static(clipsDir));

const youtube = google.youtube({ version: 'v3', auth: process.env.YT_API_KEY });
const backgroundSources = {
  minecraft:    'https://www.youtube.com/watch?v=85z7jqGAGcc',
  gta5:         'https://www.youtube.com/watch?v=EUNw8oY3W7g',
  rocketleague: 'https://www.youtube.com/watch?v=QAgFo5y91ME'
};

function toHHMMSS(sec) {
  const h = Math.floor(sec/3600).toString().padStart(2,'0'),
        m = Math.floor((sec%3600)/60).toString().padStart(2,'0'),
        s = Math.floor(sec%60).toString().padStart(2,'0');
  return `${h}:${m}:${s}`;
}

async function getLatestVideoId(channelId) {
  const resp = await youtube.search.list({
    part: 'id', channelId, order: 'date', maxResults: 1
  });
  if (!resp.data.items.length) throw new Error('No videos found');
  return resp.data.items[0].id.videoId;
}

app.get('/', (_req, res) => res.send('AutoClipper Backend Running'));

app.get('/api/videos', async (req, res) => {
  const { channelId } = req.query;
  if (!channelId) return res.status(400).json({ message: 'channelId is required' });
  try {
    const videoId = await getLatestVideoId(channelId);
    res.json({ videoId });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// OpenAI connectivity test
app.get('/api/openai-test', async (_req, res) => {
  try {
    const resp = await openai.models.list();
    return res.json({ ok: true, models: resp.data.slice(0,10).map(m => m.id) });
  } catch (err) {
    console.error('OpenAI test error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/clips', async (req, res) => {
  let { videoUrl, fontFamily, fontSize, color, outline, position, background } = req.query;
  if (!videoUrl) return res.status(400).json({ message: 'videoUrl is required' });

  fontSize = Number(fontSize) || 24;
  outline  = outline === 'true';
  position = position || 'bottom';

  try { videoUrl = decodeURIComponent(videoUrl); } catch {}
  videoUrl = videoUrl.trim().replace(/<|>/g, '');

  let videoId, normalized;
  if (/^[A-Za-z0-9_-]{11}$/.test(videoUrl)) {
    videoId = videoUrl;
    normalized = `https://youtu.be/${videoId}`;
  } else {
    normalized = videoUrl;
    try {
      videoId = ytdl.getURLVideoID(normalized);
    } catch {
      return res.status(400).json({ message: 'Invalid videoUrl' });
    }
  }

  // find peaks via comments
  const comments = await youtube.commentThreads.list({
    part: 'snippet', videoId, maxResults: 100, textFormat: 'plainText'
  });
  const freq = {};
  const regex = /\b(\d{1,2}):([0-5]\d)\b/g;
  comments.data.items.forEach(item => {
    let m, txt = item.snippet.topLevelComment.snippet.textDisplay;
    while ((m = regex.exec(txt)) !== null) {
      const t = +m[1]*60 + +m[2];
      freq[t] = (freq[t] || 0) + 1;
    }
  });
  const peaks = Object.entries(freq)
    .sort((a,b) => b[1] - a[1])
    .map(([t]) => +t)
    .slice(0, 3);

  const results = [];

  for (const peak of peaks) {
    const start = Math.max(peak - 5, 0), end = start + 30;

    // 1) Download main clip w/ audio
    const mainName = `${videoId}_${start}.mp4`;
    const mainPath = path.join(clipsDir, mainName);
    await ytdlp(normalized, {
      format: 'bestvideo+bestaudio/best',
      output: mainPath,
      downloadSections: `*${toHHMMSS(start)}-${toHHMMSS(end)}`,
      mergeOutputFormat: 'mp4'
    });

    // 2) Extract audio → WAV for Whisper
    const audioName = `${videoId}_${start}.wav`;
    const audioPath = path.join(clipsDir, audioName);
    await new Promise((resolve, reject) => {
      ffmpeg(mainPath)
        .noVideo()
        .audioCodec('pcm_s16le')
        .audioChannels(1)
        .audioFrequency(16000)
        .format('wav')
        .on('end', resolve)
        .on('error', reject)
        .save(audioPath);
    });

    // 3) Transcribe with Whisper → SRT, fallback to yt-dlp auto-subs
    let srtPath = null;
    try {
      const transcription = await openai.audio.transcriptions.create({
        file: fs.createReadStream(audioPath),
        model: 'whisper-1',
        response_format: 'verbose_json'
      });
      const segments = transcription.segments;
      const srt = segments.map((seg, i) => {
        const a = new Date(seg.start * 1000).toISOString().substr(11,12).replace('.',',');
        const b = new Date(seg.end   * 1000).toISOString().substr(11,12).replace('.',',');
        return `${i+1}\n${a} --> ${b}\n${seg.text.trim()}\n`;
      }).join('\n');
      srtPath = path.join(clipsDir, `${videoId}_${start}.srt`);
      fs.writeFileSync(srtPath, srt);
    } catch (whisperErr) {
      console.error('⚠️ Whisper failed:', whisperErr);
      console.log('→ Falling back to YouTube auto-captions via yt-dlp…');
      try {
        await ytdlp(normalized, {
          writeautomaticsub: true,
          sublangs: 'en',
          skipDownload: true,
          output: path.join(clipsDir, `${videoId}_${start}_yt.%(ext)s`)
        });
        const found = fs.readdirSync(clipsDir).find(f =>
          f.startsWith(`${videoId}_${start}_yt.`) && /\.(srt|vtt)$/.test(f)
        );
        if (found) srtPath = path.join(clipsDir, found);
      } catch (subErr) {
        console.warn('⚠️ yt-dlp subtitle fallback failed:', subErr);
      }
    }

    // 4) Overlay background & clip
    let intermediate = mainPath;
    if (background && backgroundSources[background]) {
      try {
        const bgUrl = backgroundSources[background];
        const rStart = Math.floor(Math.random() * 300);
        const bgName = `${videoId}_${start}_bg.mp4`;
        const bgPath = path.join(clipsDir, bgName);
        await ytdlp(bgUrl, {
          format: 'bestvideo+bestaudio/best',
          output: bgPath,
          downloadSections: `*${toHHMMSS(rStart)}-${toHHMMSS(rStart+30)}`,
          mergeOutputFormat: 'mp4'
        });

        const overName = `${videoId}_${start}_overlay.mp4`;
        const overPath = path.join(clipsDir, overName);
        const yOff = position === 'top'
          ? '960+10'
          : position === 'center'
            ? '960+(960-text_h)/2'
            : '960+(960-text_h)-10';
        const filters = [
          '[0:v]scale=-2:960,crop=1080:960,pad=1080:1920:0:960:black[bgp]',
          '[1:v]scale=1080:-2,pad=1080:960:(ow-iw)/2:0:black[mc]',
          '[bgp][mc]overlay=0:0[cmb]'
        ];
        await new Promise((resolve, reject) => {
          ffmpeg()
            .input(bgPath)
            .input(mainPath)
            .complexFilter(filters)
            .outputOptions([
              '-map','[cmb]',
              '-map','1:a',
              '-c:v','libx264',
              '-c:a','aac',
              '-b:a','128k',
              '-shortest'
            ])
            .on('stderr', console.error)
            .on('end', resolve)
            .on('error', reject)
            .save(overPath);
        });
        intermediate = overPath;
      } catch (overlayErr) {
        console.warn('⚠️ Overlay failed; using raw clip:', overlayErr.message);
      }
    }

    // 5) Burn in subtitles if available
    const finalName = `${videoId}_${start}_final.mp4`;
    const finalPath = path.join(clipsDir, finalName);
    if (srtPath && fs.existsSync(srtPath)) {
      await new Promise((resolve, reject) => {
        ffmpeg(intermediate)
          .videoFilter(`subtitles=${srtPath}`)
          .outputOptions(['-c:a','copy','-shortest'])
          .on('stderr', console.error)
          .on('end', resolve)
          .on('error', reject)
          .save(finalPath);
      });
    } else {
      console.warn('Subtitle file not found or invalid: ' + srtPath);
      fs.copyFileSync(intermediate, finalPath);
    }
    results.push({ url: `/clips/${finalName}`, start, end });
  }

  res.json({ clips: results });
});

app.listen(process.env.PORT || 5000, () => console.log('Server listening on 5000'));
