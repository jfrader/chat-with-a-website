import type { SessionStage } from "@profound/contracts"

export const stageLabels: Record<SessionStage, string> = {
  fetching: "Fetching the webpage",
  extracting: "Extracting readable content",
  summarizing: "Generating the summary",
}
