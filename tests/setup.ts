// Vitest setup: the fixture orders use the sandbox store as their agent-ready (tier 1) merchant.
import { SANDBOX_STORE_MERCHANT } from "@/workflows/standing-order/config";

process.env.AGENT_READY_MERCHANTS = SANDBOX_STORE_MERCHANT;
