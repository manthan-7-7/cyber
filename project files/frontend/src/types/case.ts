export type CaseStatus = "Open" | "In Progress" | "Closed";
export type CasePriority = "Low" | "Medium" | "High";

export interface Case {
  id: string;
  title: string;
  description: string | null;
  case_type: string | null;
  status: CaseStatus;
  priority: CasePriority;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface CaseCreateInput {
  title: string;
  description?: string;
  case_type?: string;
  status?: CaseStatus;
  priority?: CasePriority;
}

export interface CaseUpdateInput {
  title?: string;
  description?: string;
  case_type?: string;
  status?: CaseStatus;
  priority?: CasePriority;
}

export interface AuthUser {
  id: string;
  email: string;
}

export interface LoginResponse {
  access_token: string;
  token_type: string;
  user: AuthUser;
}

export interface EvidenceItem {
  id: string;
  case_id: string;
  file_name: string;
  storage_path: string;
  file_size: number;
  mime_type: string | null;
  sha256_hash: string | null;
  description: string | null;
  uploaded_by: string;
  processing_status: string;
  uploaded_at: string;
}

export interface DownloadResponse {
  download_url: string;
  file_name: string;
  expires_in: number;
}

// ============================================================================
// CDR Analysis Types (Module 2)
// ============================================================================

export interface CDRCaseSummary {
  case_id: string;
  case_title: string;
  has_cdr: boolean;
  total_records: number;
  date_start: string | null;
  date_end: string | null;
  unique_callers_count: number;
  unique_receivers_count: number;
  unique_towers_count: number;
  suspect_candidates_in_dataset: string[];
  message: string | null;
}

export interface SuspiciousFlag {
  id: string;
  severity: "HIGH" | "MEDIUM" | "LOW" | "INFO";
  title: string;
  description: string;
  supporting_records_count: number;
  supporting_records: Array<{
    id: string;
    timestamp: string;
    caller: string;
    receiver: string;
    duration: number;
    duration_formatted?: string;
    call_type: string;
    tower_id?: string;
    location?: string;
  }>;
}

export interface FrequentContact {
  contact_number: string;
  total_calls: number;
  incoming_calls: number;
  outgoing_calls: number;
  total_duration_seconds: number;
  average_duration_seconds: number;
  first_interaction: string;
  last_interaction: string;
}

export interface ShortIntervalCallGroup {
  group_id: string;
  reason: string;
  calls_count: number;
  time_window_seconds: number;
  records: Array<{
    id: string;
    timestamp: string;
    caller: string;
    receiver: string;
    duration: number;
    tower_id?: string;
    type: string;
  }>;
}

export interface PatternAnalysisResponse {
  case_id: string;
  suspect_mobile_number: string;
  normalized_suspect_number: string;
  analysis_timestamp: string;
  total_calls: number;
  incoming_calls: number;
  outgoing_calls: number;
  missed_calls: number;
  sms_count: number;
  incoming_outgoing_ratio: number | null;
  average_call_duration_seconds: number;
  total_call_duration_seconds: number;
  midnight_calls_count: number;
  midnight_calls: Array<{
    id: string;
    timestamp: string;
    caller: string;
    receiver: string;
    duration: number;
    duration_formatted: string;
    call_type: string;
    tower_id?: string;
    location?: string;
  }>;
  frequent_contacts: FrequentContact[];
  short_interval_calls_count: number;
  short_interval_groups: ShortIntervalCallGroup[];
  unusually_short_calls_count: number;
  unusually_long_calls_count: number;
  suspicious_flags: SuspiciousFlag[];
  disclaimer: string;
}

export interface TowerEventCandidate {
  candidate_number: string;
  candidate_call_time: string;
  time_offset_minutes: number;
  candidate_call_type: string;
  candidate_duration: number;
  tower_id: string;
  sector_id: string | null;
  record_id: string;
}

export interface SuspectCallEvent {
  event_index: number;
  record_id: string;
  event_timestamp: string;
  call_type: string;
  duration: number;
  counterpart_number: string;
  cell_tower_id: string;
  cell_sector_id: string | null;
  location: string | null;
  candidate_numbers_observed: string[];
  candidate_records: TowerEventCandidate[];
}

export interface RankedCandidate {
  rank: number;
  candidate_number: string;
  matched_events_count: number;
  total_suspect_events: number;
  match_percentage: number;
  distinct_towers_matched_count: number;
  distinct_towers: string[];
  sector_consistency_count: number;
  average_time_offset_minutes: number;
  ranking_score: number;
  supporting_events: Array<{
    event_index: number;
    suspect_event_id: string;
    suspect_time: string;
    candidate_time: string;
    tower_id: string;
    suspect_sector?: string;
    candidate_sector?: string;
    sector_match?: boolean;
    time_offset_minutes: number;
    candidate_call_type?: string;
    candidate_duration?: number;
  }>;
  classification: string;
}

export interface TowerAnalysisResponse {
  case_id: string;
  suspect_mobile_number: string;
  normalized_suspect_number: string;
  analysis_timestamp: string;
  configured_time_window_minutes: number;
  total_suspect_events_analyzed: number;
  events_with_co_locations_count: number;
  suspect_events: SuspectCallEvent[];
  total_unique_candidates_observed: number;
  common_candidates: RankedCandidate[];
  data_quality_warning: string | null;
  disclaimer: string;
}

export interface AnalysisHistoryItem {
  id: string;
  case_id: string;
  investigator_id: string;
  suspect_number: string;
  analysis_method: "PATTERN" | "CELL_TOWER";
  analysis_timestamp: string;
  analysis_parameters: Record<string, unknown>;
  result_summary: Record<string, unknown>;
  candidate_numbers: string[];
  supporting_record_count: number;
}
