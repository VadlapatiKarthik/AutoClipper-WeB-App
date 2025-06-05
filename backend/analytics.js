const { google } = require('googleapis');

const youtube = google.youtube({ version: 'v3', auth: process.env.YT_API_KEY });
const youtubeAnalytics = google.youtubeAnalytics('v2');

function parseISODuration(dur) {
  const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(dur);
  return (m && (
    (m[1] ? +m[1] * 3600 : 0) +
    (m[2] ? +m[2] * 60 : 0) +
    (m[3] ? +m[3] : 0)
  )) || 0;
}

async function getHighRetentionRanges(videoId, oauth2Client) {
  const detailResp = await youtube.videos.list({ part: 'contentDetails', id: videoId });
  if (!detailResp.data.items.length) throw new Error('Video not found');
  const durationSec = parseISODuration(detailResp.data.items[0].contentDetails.duration);

  const resp = await youtubeAnalytics.reports.query({
    auth: oauth2Client,
    ids: 'channel==MINE',
    startDate: '2020-01-01',
    endDate: new Date().toISOString().slice(0, 10),
    metrics: 'relativeRetentionPerformance',
    dimensions: 'elapsedVideoTimeRatio',
    filters: `video==${videoId}`,
    maxResults: 200
  });
  const rows = resp.data.rows || [];
  const ranges = [];
  for (let i = 0; i < rows.length; i++) {
    const [ratio, retention] = rows[i];
    const nextRatio = i < rows.length - 1 ? rows[i + 1][0] : 1;
    if (retention > 1.0) {
      ranges.push({
        startSec: Math.round(ratio * durationSec),
        endSec: Math.round(nextRatio * durationSec),
        retention
      });
    }
  }
  ranges.sort((a, b) => b.retention - a.retention);
  return ranges.map(r => ({ startSec: r.startSec, endSec: r.endSec }));
}

module.exports = { getHighRetentionRanges };
