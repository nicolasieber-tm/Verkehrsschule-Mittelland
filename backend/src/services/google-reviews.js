// Google Reviews Sync — fetches newest reviews via Places API and merges into reviews.json
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REVIEWS_FILE = path.join(__dirname, '..', 'data', 'reviews.json');

const PLACE_ID = process.env.GOOGLE_PLACE_ID || 'ChIJW6ou8Q-jSkARWMbDVntpfM4';
const API_KEY = process.env.GOOGLE_PLACES_API_KEY;
const SYNC_INTERVAL_MIN = Number(process.env.REVIEWS_SYNC_INTERVAL_MINUTES || 10080); // 7 days

function reviewKey(r) {
  return `${r.author_name}|${r.time}`;
}

export async function loadReviews() {
  const raw = await fs.readFile(REVIEWS_FILE, 'utf8');
  return JSON.parse(raw);
}

async function saveReviews(data) {
  await fs.writeFile(REVIEWS_FILE, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

async function fetchFromGoogle() {
  const url = new URL('https://maps.googleapis.com/maps/api/place/details/json');
  url.searchParams.set('place_id', PLACE_ID);
  url.searchParams.set('fields', 'rating,user_ratings_total,reviews');
  url.searchParams.set('reviews_sort', 'newest');
  url.searchParams.set('language', 'de');
  url.searchParams.set('key', API_KEY);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Places API HTTP ${res.status}`);
  const json = await res.json();
  if (json.status !== 'OK') throw new Error(`Places API status: ${json.status} ${json.error_message || ''}`);
  return json.result;
}

export async function syncReviews(log) {
  if (!API_KEY) {
    log?.warn?.('GOOGLE_PLACES_API_KEY not set, skipping review sync');
    return { added: 0, skipped: true };
  }
  const current = await loadReviews();
  const remote = await fetchFromGoogle();
  const existingKeys = new Set(current.reviews.map(reviewKey));

  let added = 0;
  for (const r of (remote.reviews || [])) {
    if (r.rating < 4) continue; // filter low ratings (defense vs trolls)
    const review = {
      author_name: r.author_name,
      rating: r.rating,
      text: r.text || '',
      time: r.time,
      profile_photo_url: r.profile_photo_url,
      author_url: r.author_url,
    };
    if (!existingKeys.has(reviewKey(review))) {
      current.reviews.push(review);
      added++;
    }
  }

  current.reviews.sort((a, b) => b.time - a.time);
  current.rating = remote.rating ?? current.rating;
  current.total = remote.user_ratings_total ?? current.total;
  current.synced_at = new Date().toISOString();

  if (added > 0) {
    await saveReviews(current);
    log?.info?.({ added, total_stored: current.reviews.length }, 'google-reviews: new reviews added');
  } else {
    // Still update synced_at + rating/total stats
    await saveReviews(current);
    log?.info?.({ total_stored: current.reviews.length }, 'google-reviews: no new reviews');
  }
  return { added, total_stored: current.reviews.length };
}

export function startReviewSync(log) {
  const intervalMs = SYNC_INTERVAL_MIN * 60 * 1000;

  async function run() {
    try {
      await syncReviews(log);
    } catch (err) {
      log?.error?.({ err: err.message }, 'google-reviews: sync failed');
    }
  }

  // Run once after a short delay (don't block startup), then on interval
  setTimeout(run, 30_000);
  setInterval(run, intervalMs);
  log?.info?.({ intervalMinutes: SYNC_INTERVAL_MIN }, 'google-reviews: sync scheduler started');
}
