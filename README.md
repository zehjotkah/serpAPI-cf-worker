# SerpApi Cloudflare Middleware

This Cloudflare Worker acts as a robust middleware between your website and SerpApi. It handles pagination, filtering, sorting, and crucially, provides a **caching and fallback mechanism** to ensure your website always displays reviews, even if SerpApi is down or you run out of credits.

## Features

*   **Robust Caching:** Automatically saves successful API responses to Cloudflare KV (Key-Value storage) for 7 days.
*   **Safety Fallback:** If SerpApi returns an error or 0 reviews, the worker serves the last known "good" data from the cache instead of breaking your UI.
*   **Pagination Handling:** Fetches multiple pages of reviews automatically.
*   **Filtering & Sorting:** Supports filtering by rating, removing empty reviews, and custom sorting (newest, highest/lowest rating).

## One-Click Deployment

You can deploy this middleware to your own Cloudflare account in minutes without touching any code.

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/zehjotkah/serpAPI-cf-worker)

**Deployment Steps:**
1.  Click the button above.
2.  Authorize Cloudflare to access your GitHub account.
3.  Follow the instructions. Cloudflare will automatically detect that this worker needs a **KV Namespace**.
4.  When asked about `REVIEWS_KV`, create a new namespace (e.g., named `reviews-cache`) and select it.
5.  Click **Deploy**.

## Manual Deployment (CLI)

If you prefer using the Wrangler CLI:

1.  Clone this repository.
2.  Install dependencies (if any).
3.  Create a KV Namespace:
    ```bash
    npx wrangler kv:namespace create REVIEWS_KV
    ```
4.  Copy the `id` from the output and paste it into `wrangler.toml`.
5.  Deploy:
    ```bash
    npx wrangler deploy
    ```

## API Usage

Once deployed, point your website to your worker's URL:

`https://your-worker-name.your-subdomain.workers.dev/?api_key=YOUR_SERPAPI_KEY&place_id=YOUR_PLACE_ID`

### Parameters:
*   `api_key`: Your SerpApi key.
*   `place_id`: Comma-separated list of Google Place IDs.
*   `fetch_all`: Set to `true` to fetch all available pages (up to 20).
*   `sort_by`: `newestFirst` (default), `highestRating`, `lowestRating`.
*   `rating`: Filter by rating (e.g., `5` or `4,5`).
*   `only_with_reviews`: Set to `true` to exclude reviews without text.
