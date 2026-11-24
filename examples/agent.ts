// A reusable agent with only the hotel tools.
import { ToolLoopAgent, isStepCount } from "ai";
import { hotelReviews, lookup, searchHotels } from "@ktemia/ai-sdk";

export const hotelAgent = new ToolLoopAgent({
  model: "openai/gpt-5-mini",
  instructions:
    "You compare hotels. Resolve the city with ktemia_lookup (kind hotelLocation), search, then read reviews for the top two before recommending one.",
  tools: {
    ktemia_lookup: lookup(),
    ktemia_search_hotels: searchHotels(),
    ktemia_get_hotel_reviews: hotelReviews(),
  },
  stopWhen: isStepCount(10),
});

const result = await hotelAgent.generate({
  prompt: "A quiet 4-star hotel in Lisbon, April 10 to 13, for two adults. Which one?",
});
console.log(result.text);
