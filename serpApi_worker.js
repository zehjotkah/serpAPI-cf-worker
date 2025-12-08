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

    try {
      const url = new URL(request.url);
      const params = url.searchParams;

      const apiKey = params.get("api_key");
      const placeIdsParam = params.get("place_id");
      const fetchAll = ["true", "1", "yes"].includes((params.get("fetch_all") || "").toLowerCase());
      const sortBy = params.get("sort_by") || "newestFirst"; // Default to newestFirst
      const hl = params.get("hl") || "de";
      const ratingFilter = params.get("rating");
      const initialNextPageToken = params.get("next_page_token");

      if (!apiKey) return new Response(JSON.stringify({ error: "Missing api_key" }), { status: 400, headers: corsHeaders });
      if (!placeIdsParam) return new Response(JSON.stringify({ error: "Missing place_id" }), { status: 400, headers: corsHeaders });

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

      // 3. Global Sort (Fix for mixed timeline)
      if (sortBy === 'newestFirst') {
        flatReviews.sort((a, b) => {
          // Use iso_date_of_last_edit if available (more accurate), otherwise iso_date
          const dateA = new Date(a.iso_date_of_last_edit || a.iso_date).getTime();
          const dateB = new Date(b.iso_date_of_last_edit || b.iso_date).getTime();
          return dateB - dateA; // Descending (Newest first)
        });
      } else if (sortBy === 'highestRating') {
         flatReviews.sort((a, b) => b.rating - a.rating);
      } else if (sortBy === 'lowestRating') {
         flatReviews.sort((a, b) => a.rating - b.rating);
      }

      return new Response(JSON.stringify({
        total_count: flatReviews.length,
        pages_fetched: totalPages,
        reviews: flatReviews
      }), {
        headers: { "Content-Type": "application/json", ...corsHeaders }
      });

    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
    }
  }
};
