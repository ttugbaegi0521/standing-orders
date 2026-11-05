// Every Channel3 call goes through this file.
import { NotWiredError } from "@/lib/errors";
import type { Product } from "@/lib/schemas";

export interface Channel3SearchParams {
  query: string;
  maxPriceCents?: number;
  limit?: number;
}

export interface Channel3Client {
  search(params: Channel3SearchParams): Promise<Product[]>;
}

export function createChannel3Client(): Channel3Client {
  return {
    async search() {
      // TODO(Fri): call Channel3 with CHANNEL3_API_KEY and map results to ProductSchema.
      throw new NotWiredError("Channel3 search");
    },
  };
}
