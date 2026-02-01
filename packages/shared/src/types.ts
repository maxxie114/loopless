export type PageState = {
  url: string;
  title: string;
  hostname: string;
  pathname: string;
  headings: string[];
  actionable_labels: string[];
  form_labels: string[];
  primary_button_texts: string[];
  last_action?: string;
  last_result?: string;
  progress_marker?: string;
};

export type PlannedAction = {
  action: string;
  cache_hit: boolean;
  source: "macro" | "semantic" | "llm";
};

export type StepResult = {
  step_index: number;
  action: string;
  cache_hit: boolean;
  url_before: string;
  url_after: string;
  page_sig: string;
  latency_ms: number;
  observe_candidates_count?: number;
  success: boolean;
  progress: boolean;
};
