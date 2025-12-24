export default {
  async fetch(request, env, ctx) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    const params = url.searchParams;
    
    // Sort params to ensure consistent cache keys
    params.sort();
    const cacheKey = params.toString();

    // Helper to return JSON response
    const jsonResponse = (data, status = 200, extraHeaders = {}) => {
      return new Response(JSON.stringify(data), {
        status,
        headers: { 
          "Content-Type": "application/json", 
          ...corsHeaders,
          ...extraHeaders
        }
      });
    };

    try {
      // ---------------------------------------------------------
      // CORE LOGIC (Extracted from previous version)
      // ---------------------------------------------------------
      const apiKey = params.get("api_key");
      const placeIdsParam = params.get("place_id");
      const fetchAll = ["true", "1", "yes"].includes((params.get("fetch_all") || "").toLowerCase());
      const sortBy = params.get("sort_by") || "newestFirst";
      const hl = params.get("hl") || "de";
      const ratingFilter = params.get("rating");
      const onlyWithReviews = ["true", "1", "yes"].includes((params.get("only_with_reviews") || "").toLowerCase());
      const limitParam = params.get("limit");
      const limit = limitParam ? parseInt(limitParam) : null;
      const initialNextPageToken = params.get("next_page_token");

      if (!apiKey) return jsonResponse({ error: "Missing api_key" }, 400);
      if (!placeIdsParam) return jsonResponse({ error: "Missing place_id" }, 400);

      const placeIds = placeIdsParam.split(",").map(id => id.trim());

      const fetchReviewsForPlace = async (placeId) => {
        let allReviews = [];
        let nextPageToken = initialNextPageToken;
        let pageCount = 0;
        const maxPages = 20;

        do {
          const serpParams = new URLSearchParams({
            engine: "google_maps_reviews",
            place_id: placeId,
            api_key: apiKey,
            hl: hl,
            sort_by: sortBy
          });

          if (nextPageToken) serpParams.set("next_page_token", nextPageToken);

          const response = await fetch(`https://serpapi.com/search.json?${serpParams.toString()}`);
          const data = await response.json();

          if (data.error) {
            console.error(`Error fetching place ${placeId}:`, data.error);
            break; 
            // We break here, but we don't throw yet, allowing partial results from other places 
            // or existing pages to be processed.
          }

          if (data.reviews && Array.isArray(data.reviews)) {
            const taggedReviews = data.reviews.map(r => ({ ...r, source_place_id: placeId }));
            allReviews = allReviews.concat(taggedReviews);
          }

          nextPageToken = data.serpapi_pagination?.next_page_token;
          pageCount++;

          if(fetchAll && nextPageToken) await new Promise(resolve => setTimeout(resolve, 200));

        } while (fetchAll && nextPageToken && pageCount < maxPages);

        return { reviews: allReviews, pagesFetched: pageCount };
      };

      // 1. Fetch all
      const results = await Promise.all(placeIds.map(id => fetchReviewsForPlace(id)));

      // 2. Flatten
      let flatReviews = results.flatMap(r => r.reviews);
      const totalPages = results.reduce((acc, r) => acc + r.pagesFetched, 0);

      // 2.1 Filter by rating
      if (ratingFilter) {
        const allowedRatings = ratingFilter.split(',').map(r => parseInt(r.trim())).filter(n => !isNaN(n));
        if (allowedRatings.length > 0) {
          flatReviews = flatReviews.filter(review => allowedRatings.includes(review.rating));
        }
      }

      // 2.2 Filter out empty reviews
      if (onlyWithReviews) {
        flatReviews = flatReviews.filter(review => review.snippet && review.snippet.trim().length > 0);
      }

      // 3. Global Sort
      if (sortBy === 'newestFirst') {
        flatReviews.sort((a, b) => {
          const dateA = new Date(a.iso_date_of_last_edit || a.iso_date).getTime();
          const dateB = new Date(b.iso_date_of_last_edit || b.iso_date).getTime();
          return dateB - dateA;
        });
      } else if (sortBy === 'highestRating') {
         flatReviews.sort((a, b) => b.rating - a.rating);
      } else if (sortBy === 'lowestRating') {
         flatReviews.sort((a, b) => a.rating - b.rating);
      }

      // 4. Limit
      const totalCount = flatReviews.length;
      if (limit && limit > 0) {
        flatReviews = flatReviews.slice(0, limit);
      }

      const responseData = {
        total_count: totalCount,
        returned_count: flatReviews.length,
        pages_fetched: totalPages,
        reviews: flatReviews
      };

      // ---------------------------------------------------------
      // CACHING STRATEGY
      // ---------------------------------------------------------
      
      // If we got results, this is a "Good" response. Cache it.
      if (responseData.total_count > 0) {
        if (env.REVIEWS_KV) {
          // Cache for 7 days (604800 seconds)
          // Use ctx.waitUntil to not block the response
          ctx.waitUntil(
            env.REVIEWS_KV.put(cacheKey, JSON.stringify(responseData), { expirationTtl: 604800 })
              .catch(e => console.error("KV Put Error:", e))
          );
        }
        return jsonResponse(responseData);
      } 
      
      // If we got 0 results, it MIGHT be a failure/empty API response.
      // Let's check if we have a backup in cache.
      throw new Error("No reviews found (forcing fallback check)");

    } catch (err) {
      console.error("Worker Error or Empty Result:", err);

      // FALLBACK: Try to serve from KV
      if (env.REVIEWS_KV) {
        try {
          const cachedData = await env.REVIEWS_KV.get(cacheKey);
          if (cachedData) {
            console.log("Serving from KV fallback");
            return jsonResponse(JSON.parse(cachedData), 200, { "X-Served-From-Cache": "true" });
          }
        } catch (kvErr) {
          console.error("KV Get Error:", kvErr);
        }
      }

      // If no cache or KV error, return the original error/empty state
      // (If it was the "No reviews found" error, we might want to just return an empty list if we really have nothing)
      if (err.message === "No reviews found (forcing fallback check)") {
         return jsonResponse({
            total_count: 0,
            returned_count: 0,
            pages_fetched: 0,
            reviews: [],
            warning: "No reviews found and no cache available."
         });
      }

      return jsonResponse({ error: err.message }, 500);
    }
  }
};
