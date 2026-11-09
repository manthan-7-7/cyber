"use client";

import { useEffect, useState } from "react";
import {
  Case,
  CDRCaseSummary,
  PatternAnalysisResponse,
  RankedCandidate,
  TowerAnalysisResponse,
} from "@/types/case";
import {
  fetchCDRCaseSummary,
  runPatternAnalysis,
  runTowerAnalysis,
} from "@/lib/api";

interface CDRAnalysisViewProps {
  token: string | null;
  cases: Case[];
  selectedCaseId: string | null;
  onSelectCaseId: (id: string) => void;
  onRequestAuth: () => void;
}

export default function CDRAnalysisView({
  token,
  cases,
  selectedCaseId,
  onSelectCaseId,
  onRequestAuth,
}: CDRAnalysisViewProps) {
  // Case & CDR summary state
  const [cdrSummary, setCdrSummary] = useState<CDRCaseSummary | null>(null);
  const [isLoadingSummary, setIsLoadingSummary] = useState<boolean>(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  // Search parameters
  const [suspectNumber, setSuspectNumber] = useState<string>("");
  const [suspectError, setSuspectError] = useState<string | null>(null);
  const [timeWindowMinutes, setTimeWindowMinutes] = useState<number>(10);

  // Analysis states
  const [activeAnalysisMode, setActiveAnalysisMode] = useState<"pattern" | "tower" | null>(null);
  const [isExecutingAnalysis, setIsExecutingAnalysis] = useState<boolean>(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [patternResults, setPatternResults] = useState<PatternAnalysisResponse | null>(null);
  const [towerResults, setTowerResults] = useState<TowerAnalysisResponse | null>(null);

  // Drilldown modals
  const [inspectedCandidate, setInspectedCandidate] = useState<RankedCandidate | null>(null);
  const [expandedFlagId, setExpandedFlagId] = useState<string | null>(null);

  // Selected case object
  const currentCase = cases.find((c) => c.id === selectedCaseId) || null;

  // Load CDR summary whenever selectedCaseId changes
  useEffect(() => {
    let isMounted = true;

    const loadSummary = async () => {
      await Promise.resolve();
      if (!isMounted) return;

      // Reset previous analysis results when case changes
      setPatternResults(null);
      setTowerResults(null);
      setAnalysisError(null);

      if (!token || !selectedCaseId) {
        setCdrSummary(null);
        return;
      }

      setIsLoadingSummary(true);
      setSummaryError(null);

      try {
        const summary = await fetchCDRCaseSummary(token, selectedCaseId);
        if (!isMounted) return;
        setCdrSummary(summary);
        // Pre-fill suspect number with the highest-activity suspect candidate for the selected case
        if (summary.suspect_candidates_in_dataset && summary.suspect_candidates_in_dataset.length > 0) {
          setSuspectNumber(summary.suspect_candidates_in_dataset[0]);
        }
      } catch (err) {
        if (!isMounted) return;
        setSummaryError(err instanceof Error ? err.message : "Failed to load CDR summary.");
        setCdrSummary(null);
      } finally {
        if (isMounted) setIsLoadingSummary(false);
      }
    };

    loadSummary();

    return () => {
      isMounted = false;
    };
  }, [token, selectedCaseId]);

  // Client-side phone validation
  const validatePhone = (num: string): boolean => {
    const trimmed = num.trim();
    if (!trimmed) {
      setSuspectError("Suspect mobile number is required.");
      return false;
    }
    if (/[a-zA-Z]/.test(trimmed)) {
      setSuspectError("Mobile number must not contain alphabetic letters.");
      return false;
    }
    const digitsOnly = trimmed.replace(/[\s\-\(\)\.\+]/g, "");
    if (digitsOnly.length < 7) {
      setSuspectError("Mobile number is too short (min 7 digits).");
      return false;
    }
    if (digitsOnly.length > 15) {
      setSuspectError("Mobile number exceeds 15 digits.");
      return false;
    }
    setSuspectError(null);
    return true;
  };

  // Run Pattern Analysis
  const handleRunPattern = async () => {
    if (!token) {
      onRequestAuth();
      return;
    }
    if (!selectedCaseId) {
      alert("Please select an investigation case first.");
      return;
    }
    if (!validatePhone(suspectNumber)) return;

    setIsExecutingAnalysis(true);
    setAnalysisError(null);
    setActiveAnalysisMode("pattern");

    try {
      const res = await runPatternAnalysis(token, selectedCaseId, suspectNumber.trim());
      setPatternResults(res);
      setTowerResults(null);
    } catch (err: unknown) {
      setAnalysisError(err instanceof Error ? err.message : "Pattern analysis failed.");
    } finally {
      setIsExecutingAnalysis(false);
    }
  };

  // Run Cell Tower Analysis
  const handleRunTower = async () => {
    if (!token) {
      onRequestAuth();
      return;
    }
    if (!selectedCaseId) {
      alert("Please select an investigation case first.");
      return;
    }
    if (!validatePhone(suspectNumber)) return;

    setIsExecutingAnalysis(true);
    setAnalysisError(null);
    setActiveAnalysisMode("tower");

    try {
      const res = await runTowerAnalysis(token, selectedCaseId, suspectNumber.trim(), timeWindowMinutes);
      setTowerResults(res);
      setPatternResults(null);
    } catch (err: unknown) {
      setAnalysisError(err instanceof Error ? err.message : "Cell tower analysis failed.");
    } finally {
      setIsExecutingAnalysis(false);
    }
  };

  // Format seconds to mm:ss
  const formatSeconds = (sec: number) => {
    const mins = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${mins}m ${s < 10 ? "0" : ""}${s}s`;
  };

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Header Banner */}
      <div className="bg-white border border-gray-200 rounded-lg p-5 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="bg-blue-600 text-white text-xs font-bold px-2 py-0.5 rounded">
                MODULE 2
              </span>
              <h2 className="text-base font-bold text-gray-900 tracking-tight">
                CDR Analysis & Suspect Identification
              </h2>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Automated pattern detection, midnight communication anomalies, and multi-event cell tower co-location analysis.
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-gray-500">Active Mode:</span>
            <span className="font-semibold text-gray-800">
              {activeAnalysisMode === "pattern"
                ? "Pattern-Based Analysis"
                : activeAnalysisMode === "tower"
                ? "Common Cell Tower Analysis"
                : "Idle — Ready"}
            </span>
          </div>
        </div>
      </div>

      {/* SECTION A: CASE SELECTION & DATASET AVAILABILITY */}
      <div className="bg-white border border-gray-200 rounded-lg p-5 shadow-xs space-y-4">
        <div className="flex items-center justify-between border-b border-gray-100 pb-3">
          <div>
            <h3 className="text-xs font-bold text-gray-800 uppercase tracking-wider">
              1. Investigation Case Selection
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Select an authorized case to inspect its associated Call Detail Records dataset.
            </p>
          </div>
          {cdrSummary && (
            <span
              className={`text-xs px-2.5 py-1 rounded font-medium border ${
                cdrSummary.has_cdr
                  ? "bg-green-50 text-green-700 border-green-200"
                  : "bg-amber-50 text-amber-700 border-amber-200"
              }`}
            >
              {cdrSummary.has_cdr
                ? `✓ CDR Dataset Available (${cdrSummary.total_records} Records)`
                : "⚠ No CDR Dataset Attached"}
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          {/* Dropdown */}
          <div className="md:col-span-2">
            <label className="block text-gray-700 font-medium mb-1">
              Select Investigation Case <span className="text-red-500">*</span>
            </label>
            <select
              value={selectedCaseId || ""}
              onChange={(e) => onSelectCaseId(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2 bg-white text-gray-900 font-medium focus:outline-none focus:ring-1 focus:ring-blue-500 text-xs"
            >
              {cases.length === 0 ? (
                <option value="">No cases available</option>
              ) : (
                cases.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title} — [{c.status} | Priority: {c.priority}]
                  </option>
                ))
              )}
            </select>
          </div>

          {/* Current Case Badge Card */}
          <div className="bg-gray-50 border border-gray-200 rounded p-3 text-xs space-y-1">
            <div className="text-[11px] text-gray-500 font-medium">Selected Case ID:</div>
            <div className="font-mono text-gray-800 text-[11px] truncate" title={selectedCaseId || "None"}>
              {selectedCaseId || "None selected"}
            </div>
            <div className="pt-1 flex items-center justify-between text-[11px]">
              <span className="text-gray-500">Classification:</span>
              <span className="font-medium text-gray-800">{currentCase?.case_type || "General"}</span>
            </div>
          </div>
        </div>

        {/* Dataset Availability Banner */}
        {isLoadingSummary ? (
          <div className="p-3 bg-blue-50 border border-blue-200 rounded text-xs text-blue-700 flex items-center gap-2">
            <svg className="w-4 h-4 animate-spin text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span>Verifying case CDR dataset availability...</span>
          </div>
        ) : summaryError ? (
          <div className="p-3 bg-red-50 border border-red-200 rounded text-xs text-red-700">
            {summaryError}
          </div>
        ) : cdrSummary && !cdrSummary.has_cdr ? (
          <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 flex items-start gap-3">
            <svg className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div>
              <p className="font-semibold text-amber-900">No CDR Dataset for this Case</p>
              <p className="mt-0.5 text-amber-700">
                {cdrSummary.message || "This investigation case does not have an attached Call Detail Record dataset."}
              </p>
              <p className="mt-1 text-gray-600 font-medium">
                To test CDR pattern analysis and candidate identification, select an active case such as{" "}
                <span className="text-blue-700 underline cursor-pointer" onClick={() => onSelectCaseId("c1a1a1a1-1111-4111-a111-111111111111")}>
                  Operation ShadowCell
                </span>.
              </p>
            </div>
          </div>
        ) : cdrSummary && cdrSummary.has_cdr ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-blue-50/50 border border-blue-100 rounded-lg p-3 text-xs">
            <div>
              <span className="text-gray-500 block text-[11px]">Total Records</span>
              <span className="font-bold text-gray-900 text-sm">{cdrSummary.total_records}</span>
            </div>
            <div>
              <span className="text-gray-500 block text-[11px]">Distinct Towers</span>
              <span className="font-bold text-gray-900 text-sm">{cdrSummary.unique_towers_count}</span>
            </div>
            <div>
              <span className="text-gray-500 block text-[11px]">Active Phone Lines</span>
              <span className="font-bold text-gray-900 text-sm">
                {cdrSummary.unique_callers_count + cdrSummary.unique_receivers_count}
              </span>
            </div>
            <div>
              <span className="text-gray-500 block text-[11px]">Date Range</span>
              <span className="font-medium text-gray-800 text-[11px] block truncate">
                {cdrSummary.date_start ? cdrSummary.date_start.slice(0, 10) : "N/A"} to{" "}
                {cdrSummary.date_end ? cdrSummary.date_end.slice(0, 10) : "N/A"}
              </span>
            </div>
          </div>
        ) : null}
      </div>

      {/* SECTION B: SUSPECT NUMBER INPUT */}
      <div className="bg-white border border-gray-200 rounded-lg p-5 shadow-xs space-y-4">
        <div className="border-b border-gray-100 pb-3">
          <h3 className="text-xs font-bold text-gray-800 uppercase tracking-wider">
            2. Suspect Mobile Number
          </h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Enter the target mobile number to investigate communication patterns or run common cell tower co-location analysis.
          </p>
        </div>

        <div className="max-w-xl space-y-2 text-xs">
          <label className="block text-gray-700 font-medium">
            Target Mobile Number <span className="text-red-500">*</span>
          </label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                type="text"
                placeholder="e.g. 9876500001 or +91 98765 00001"
                value={suspectNumber}
                onChange={(e) => {
                  setSuspectNumber(e.target.value);
                  validatePhone(e.target.value);
                }}
                className={`w-full px-3 py-2 border rounded font-mono text-xs focus:outline-none focus:ring-1 ${
                  suspectError
                    ? "border-red-400 focus:ring-red-400 bg-red-50/30"
                    : "border-gray-300 focus:ring-blue-500 bg-white"
                }`}
              />
              {suspectNumber && !suspectError && (
                <span className="absolute right-2.5 top-2 text-green-600 font-bold text-xs">
                  ✓
                </span>
              )}
            </div>
          </div>
          {suspectError && <p className="text-xs text-red-600 font-medium">{suspectError}</p>}

          {/* Quick-select chips from dataset */}
          {cdrSummary?.suspect_candidates_in_dataset && cdrSummary.suspect_candidates_in_dataset.length > 0 && (
            <div className="pt-2">
              <span className="text-[11px] text-gray-500 block mb-1.5 font-medium">
                Detected numbers in this case&apos;s CDR dataset (click to select):
              </span>
              <div className="flex flex-wrap gap-1.5">
                {cdrSummary.suspect_candidates_in_dataset.map((cand) => (
                  <button
                    key={cand}
                    type="button"
                    onClick={() => {
                      setSuspectNumber(cand);
                      validatePhone(cand);
                    }}
                    className={`px-2 py-1 rounded text-xs font-mono border transition-colors cursor-pointer ${
                      suspectNumber === cand
                        ? "bg-blue-600 text-white border-blue-600 font-semibold"
                        : "bg-gray-100 hover:bg-gray-200 text-gray-700 border-gray-300"
                    }`}
                  >
                    {cand}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* SECTION C: ANALYSIS OPTIONS CARDS */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Card 1: Pattern-Based Analysis */}
        <div className="bg-white border border-gray-200 rounded-lg p-5 shadow-xs flex flex-col justify-between space-y-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-xs">
                P
              </div>
              <h4 className="text-sm font-bold text-gray-900">Pattern-Based Suspicious Activity Analysis</h4>
            </div>
            <p className="text-xs text-gray-600 leading-relaxed">
              Analyzes communication anomalies: midnight calls (23:00–05:00), rapid short-interval bursts, frequent contacts, duration outliers, and asymmetric calling directions.
            </p>
            <ul className="text-[11px] text-gray-500 space-y-1 list-disc list-inside">
              <li>Midnight calling detection</li>
              <li>Rapid redial / burst groups</li>
              <li>Frequent contact ranking</li>
              <li>Signaling & ping call flags</li>
            </ul>
          </div>

          <div className="pt-3 border-t border-gray-100">
            <button
              onClick={handleRunPattern}
              disabled={isExecutingAnalysis || !selectedCaseId || !suspectNumber || !cdrSummary?.has_cdr}
              className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded text-xs font-medium flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              {isExecutingAnalysis && activeAnalysisMode === "pattern" ? (
                <>
                  <svg className="w-3.5 h-3.5 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  <span>Running Pattern Analysis...</span>
                </>
              ) : (
                <>
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                  <span>Run Pattern Analysis</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Card 2: Common Cell Tower Analysis */}
        <div className="bg-white border border-gray-200 rounded-lg p-5 shadow-xs flex flex-col justify-between space-y-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-xs">
                T
              </div>
              <h4 className="text-sm font-bold text-gray-900">Common Cell Tower Analysis (Suspect Identification)</h4>
            </div>
            <p className="text-xs text-gray-600 leading-relaxed">
              Discovers potentially associated candidate numbers co-located around the suspect&apos;s physical towers across multiple events within a configurable observation window.
            </p>
            {/* Time Window Config */}
            <div className="pt-1 flex items-center justify-between text-xs bg-gray-50 p-2.5 rounded border border-gray-200">
              <span className="font-medium text-gray-700">Observation Window:</span>
              <div className="flex items-center gap-1.5">
                {[5, 10, 15, 30].map((mins) => (
                  <button
                    key={mins}
                    type="button"
                    onClick={() => setTimeWindowMinutes(mins)}
                    className={`px-2 py-0.5 rounded text-xs font-medium border cursor-pointer ${
                      timeWindowMinutes === mins
                        ? "bg-indigo-600 text-white border-indigo-600 font-bold"
                        : "bg-white text-gray-700 border-gray-300 hover:bg-gray-100"
                    }`}
                  >
                    ±{mins}m
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="pt-3 border-t border-gray-100">
            <button
              onClick={handleRunTower}
              disabled={isExecutingAnalysis || !selectedCaseId || !suspectNumber || !cdrSummary?.has_cdr}
              className="w-full py-2 px-4 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded text-xs font-medium flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              {isExecutingAnalysis && activeAnalysisMode === "tower" ? (
                <>
                  <svg className="w-3.5 h-3.5 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  <span>Running Common Cell Tower Algorithm...</span>
                </>
              ) : (
                <>
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  <span>Run Common Tower Analysis</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Analysis Error Message */}
      {analysisError && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800 flex items-center justify-between">
          <span>{analysisError}</span>
          <button onClick={() => setAnalysisError(null)} className="text-red-600 font-bold ml-2">
            ✕
          </button>
        </div>
      )}

      {/* ==================================================================== */}
      {/* SECTION D: PATTERN ANALYSIS RESULTS VIEW                             */}
      {/* ==================================================================== */}
      {patternResults && (
        <div className="space-y-6">
          {/* Header */}
          <div className="bg-white border border-gray-200 rounded-lg p-5 shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 pb-3">
              <div>
                <h3 className="text-sm font-bold text-gray-900">Pattern Analysis Forensic Findings</h3>
                <p className="text-xs text-gray-500 font-mono">
                  Suspect Line: {patternResults.suspect_mobile_number} (Normalized: {patternResults.normalized_suspect_number})
                </p>
              </div>
              <span className="text-[11px] text-gray-400 font-mono">
                Analyzed at: {new Date(patternResults.analysis_timestamp).toLocaleTimeString()}
              </span>
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 pt-4 text-xs">
              <div className="bg-gray-50 border border-gray-200 rounded p-3 text-center">
                <span className="text-gray-500 text-[11px] block">Total Calls</span>
                <span className="text-xl font-bold text-gray-900 mt-1 block">{patternResults.total_calls}</span>
              </div>
              <div className="bg-gray-50 border border-gray-200 rounded p-3 text-center">
                <span className="text-gray-500 text-[11px] block">In / Out Ratio</span>
                <span className="text-xl font-bold text-blue-700 mt-1 block">
                  {patternResults.incoming_calls} / {patternResults.outgoing_calls}
                </span>
              </div>
              <div className="bg-gray-50 border border-gray-200 rounded p-3 text-center">
                <span className="text-gray-500 text-[11px] block">Avg Duration</span>
                <span className="text-xl font-bold text-gray-900 mt-1 block">
                  {formatSeconds(patternResults.average_call_duration_seconds)}
                </span>
              </div>
              <div className="bg-gray-50 border border-gray-200 rounded p-3 text-center">
                <span className="text-gray-500 text-[11px] block">Midnight Calls</span>
                <span className={`text-xl font-bold mt-1 block ${patternResults.midnight_calls_count > 0 ? "text-red-600" : "text-gray-900"}`}>
                  {patternResults.midnight_calls_count}
                </span>
              </div>
              <div className="bg-gray-50 border border-gray-200 rounded p-3 text-center">
                <span className="text-gray-500 text-[11px] block">Short Bursts</span>
                <span className="text-xl font-bold text-amber-600 mt-1 block">
                  {patternResults.short_interval_groups.length}
                </span>
              </div>
              <div className="bg-gray-50 border border-gray-200 rounded p-3 text-center">
                <span className="text-gray-500 text-[11px] block">Flags Raised</span>
                <span className="text-xl font-bold text-red-600 mt-1 block">
                  {patternResults.suspicious_flags.length}
                </span>
              </div>
            </div>
          </div>

          {/* Suspicious Flags */}
          <div className="bg-white border border-gray-200 rounded-lg p-5 shadow-xs space-y-3">
            <h4 className="text-xs font-bold text-gray-800 uppercase tracking-wider">
              Suspicious Pattern Flags & Explanations
            </h4>
            <div className="space-y-3">
              {patternResults.suspicious_flags.map((flag) => (
                <div
                  key={flag.id}
                  className={`border rounded-lg p-4 text-xs transition-colors ${
                    flag.severity === "HIGH"
                      ? "bg-red-50/40 border-red-200"
                      : flag.severity === "MEDIUM"
                      ? "bg-amber-50/40 border-amber-200"
                      : "bg-blue-50/40 border-blue-200"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          flag.severity === "HIGH"
                            ? "bg-red-600 text-white"
                            : flag.severity === "MEDIUM"
                            ? "bg-amber-600 text-white"
                            : "bg-blue-600 text-white"
                        }`}
                      >
                        {flag.severity}
                      </span>
                      <span className="font-bold text-gray-900">{flag.title}</span>
                    </div>
                    {flag.supporting_records.length > 0 && (
                      <button
                        onClick={() =>
                          setExpandedFlagId((prev) => (prev === flag.id ? null : flag.id))
                        }
                        className="text-blue-600 hover:text-blue-800 font-medium cursor-pointer"
                      >
                        {expandedFlagId === flag.id ? "Hide Supporting Records ▲" : `View ${flag.supporting_records_count} Records ▼`}
                      </button>
                    )}
                  </div>
                  <p className="text-gray-700 mt-2 leading-relaxed">{flag.description}</p>

                  {/* Expanded supporting records */}
                  {expandedFlagId === flag.id && flag.supporting_records.length > 0 && (
                    <div className="mt-3 overflow-x-auto border border-gray-200 rounded bg-white">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-gray-50 border-b border-gray-200 text-gray-500 uppercase font-medium">
                          <tr>
                            <th className="px-3 py-2">Timestamp</th>
                            <th className="px-3 py-2">Direction</th>
                            <th className="px-3 py-2">Counterpart</th>
                            <th className="px-3 py-2">Duration</th>
                            <th className="px-3 py-2">Tower ID</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {flag.supporting_records.map((r, i) => (
                            <tr key={i} className="hover:bg-gray-50">
                              <td className="px-3 py-2 font-mono text-[11px] text-gray-700">{r.timestamp}</td>
                              <td className="px-3 py-2 text-gray-700">{r.call_type || "Voice"}</td>
                              <td className="px-3 py-2 font-mono text-[11px] text-gray-900">
                                {r.caller === patternResults.suspect_mobile_number ? r.receiver : r.caller}
                              </td>
                              <td className="px-3 py-2 font-mono text-[11px] text-gray-700">{formatSeconds(r.duration)}</td>
                              <td className="px-3 py-2 font-mono text-[11px] text-gray-700">{r.tower_id || "N/A"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Frequent Contacts Table */}
          <div className="bg-white border border-gray-200 rounded-lg p-5 shadow-xs space-y-3">
            <h4 className="text-xs font-bold text-gray-800 uppercase tracking-wider">
              Frequently Contacted Numbers (Ranked)
            </h4>
            <div className="overflow-x-auto border border-gray-200 rounded-lg">
              <table className="w-full text-left text-xs">
                <thead className="bg-gray-50 border-b border-gray-200 text-gray-500 uppercase font-medium">
                  <tr>
                    <th className="px-4 py-3">Rank</th>
                    <th className="px-4 py-3">Contact Number</th>
                    <th className="px-4 py-3">Total Calls</th>
                    <th className="px-4 py-3">Incoming</th>
                    <th className="px-4 py-3">Outgoing</th>
                    <th className="px-4 py-3">Total Duration</th>
                    <th className="px-4 py-3">Avg Duration</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {patternResults.frequent_contacts.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-6 text-center text-gray-400">
                        No external contacts found for this number.
                      </td>
                    </tr>
                  ) : (
                    patternResults.frequent_contacts.map((c, i) => (
                      <tr key={i} className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-bold text-gray-500">#{i + 1}</td>
                        <td className="px-4 py-3 font-mono font-medium text-blue-700">{c.contact_number}</td>
                        <td className="px-4 py-3 font-semibold text-gray-900">{c.total_calls}</td>
                        <td className="px-4 py-3 text-gray-600">{c.incoming_calls}</td>
                        <td className="px-4 py-3 text-gray-600">{c.outgoing_calls}</td>
                        <td className="px-4 py-3 font-mono text-gray-700">{formatSeconds(c.total_duration_seconds)}</td>
                        <td className="px-4 py-3 font-mono text-gray-700">{c.average_duration_seconds}s</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Legal / Investigative Disclaimer */}
          <div className="p-3 bg-gray-100 border border-gray-200 rounded text-[11px] text-gray-600 italic text-center">
            {patternResults.disclaimer}
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* SECTION E: COMMON CELL TOWER ANALYSIS RESULTS VIEW                   */}
      {/* ==================================================================== */}
      {towerResults && (
        <div className="space-y-6">
          {/* Prominent Legal Disclaimer Banner */}
          <div className="bg-amber-50 border border-amber-300 rounded-lg p-4 text-xs text-amber-900 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <svg className="w-5 h-5 text-amber-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <div>
                <span className="font-bold uppercase tracking-wider block">
                  Potential Association — Requires Investigator Verification
                </span>
                <span className="text-amber-800 mt-0.5 block">
                  {towerResults.disclaimer}
                </span>
              </div>
            </div>
          </div>

          {/* Data quality warning if any */}
          {towerResults.data_quality_warning && (
            <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-xs text-yellow-800">
              <strong>Data Limitation:</strong> {towerResults.data_quality_warning}
            </div>
          )}

          {/* Summary KPIs */}
          <div className="bg-white border border-gray-200 rounded-lg p-5 shadow-xs">
            <div className="border-b border-gray-100 pb-3 flex justify-between items-center">
              <div>
                <h3 className="text-sm font-bold text-gray-900">Cell Tower Correlation Findings</h3>
                <p className="text-xs text-gray-500 font-mono">
                  Suspect: {towerResults.suspect_mobile_number} | Observation Window: ±{towerResults.configured_time_window_minutes} minutes
                </p>
              </div>
              <span className="text-xs bg-indigo-50 text-indigo-700 border border-indigo-200 font-medium px-2 py-0.5 rounded">
                Algorithm: Multi-Event Spatio-Temporal Intersect
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-4 text-xs">
              <div className="bg-gray-50 border border-gray-200 rounded p-3 text-center">
                <span className="text-gray-500 text-[11px] block">Suspect Events Analyzed</span>
                <span className="text-xl font-bold text-gray-900 mt-1 block">
                  {towerResults.total_suspect_events_analyzed}
                </span>
              </div>
              <div className="bg-gray-50 border border-gray-200 rounded p-3 text-center">
                <span className="text-gray-500 text-[11px] block">Events with Co-locations</span>
                <span className="text-xl font-bold text-indigo-700 mt-1 block">
                  {towerResults.events_with_co_locations_count}
                </span>
              </div>
              <div className="bg-gray-50 border border-gray-200 rounded p-3 text-center">
                <span className="text-gray-500 text-[11px] block">Unique Candidates</span>
                <span className="text-xl font-bold text-gray-900 mt-1 block">
                  {towerResults.total_unique_candidates_observed}
                </span>
              </div>
              <div className="bg-gray-50 border border-gray-200 rounded p-3 text-center">
                <span className="text-gray-500 text-[11px] block">Common Recurring Candidates</span>
                <span className="text-xl font-bold text-green-700 mt-1 block">
                  {towerResults.common_candidates.filter((c) => c.matched_events_count >= 2).length}
                </span>
              </div>
            </div>
          </div>

          {/* Ranked Candidates Table */}
          <div className="bg-white border border-gray-200 rounded-lg p-5 shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-xs font-bold text-gray-800 uppercase tracking-wider">
                  Ranked Associated Candidates (Spatio-Temporal Co-Location)
                </h4>
                <p className="text-xs text-gray-500 mt-0.5">
                  Mobile lines observed co-located around the suspect&apos;s physical cell towers across multiple call events.
                </p>
              </div>
              <span className="text-xs bg-gray-100 text-gray-700 px-2 py-0.5 rounded font-mono">
                {towerResults.common_candidates.length} candidates
              </span>
            </div>

            <div className="overflow-x-auto border border-gray-200 rounded-lg">
              <table className="w-full text-left text-xs">
                <thead className="bg-gray-50 border-b border-gray-200 text-gray-500 uppercase font-medium">
                  <tr>
                    <th className="px-4 py-3">Rank</th>
                    <th className="px-4 py-3">Candidate Mobile Number</th>
                    <th className="px-4 py-3">Match %</th>
                    <th className="px-4 py-3">Events Matched</th>
                    <th className="px-4 py-3">Towers Matched</th>
                    <th className="px-4 py-3">Avg Offset</th>
                    <th className="px-4 py-3">Classification</th>
                    <th className="px-4 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {towerResults.common_candidates.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center text-gray-400">
                        No co-located candidates observed within the {towerResults.configured_time_window_minutes}-minute window.
                      </td>
                    </tr>
                  ) : (
                    towerResults.common_candidates.map((cand) => (
                      <tr key={cand.candidate_number} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3">
                          <span
                            className={`w-6 h-6 rounded-full inline-flex items-center justify-center font-bold text-xs ${
                              cand.rank === 1
                                ? "bg-amber-100 text-amber-800 border border-amber-300"
                                : cand.rank === 2
                                ? "bg-gray-200 text-gray-700"
                                : "bg-gray-100 text-gray-600"
                            }`}
                          >
                            #{cand.rank}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-mono font-bold text-blue-700 text-xs">
                          {cand.candidate_number}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="w-16 bg-gray-200 rounded-full h-1.5 overflow-hidden">
                              <div
                                className="bg-indigo-600 h-1.5 rounded-full"
                                style={{ width: `${Math.min(cand.match_percentage, 100)}%` }}
                              ></div>
                            </div>
                            <span className="font-semibold text-gray-900">{cand.match_percentage}%</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 font-medium text-gray-800">
                          {cand.matched_events_count} of {cand.total_suspect_events} events
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {cand.distinct_towers.map((t) => (
                              <span key={t} className="bg-gray-100 text-gray-700 border border-gray-200 px-1.5 py-0.5 rounded text-[10px] font-mono">
                                {t}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-3 font-mono text-gray-700">
                          ±{cand.average_time_offset_minutes}m
                        </td>
                        <td className="px-4 py-3">
                          <span className="bg-amber-50 text-amber-800 border border-amber-200 px-2 py-0.5 rounded text-[10px] font-medium block truncate max-w-[200px]" title={cand.classification}>
                            Potential Association
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            onClick={() => setInspectedCandidate(cand)}
                            className="text-xs bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 px-2.5 py-1 rounded font-medium cursor-pointer"
                          >
                            Inspect Records ({cand.supporting_events.length})
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Event-by-Event Spatio-Temporal Timeline Breakdown */}
          <div className="bg-white border border-gray-200 rounded-lg p-5 shadow-xs space-y-4">
            <h4 className="text-xs font-bold text-gray-800 uppercase tracking-wider">
              Chronological Suspect Events & Co-located Cell Observations
            </h4>
            <div className="space-y-3">
              {towerResults.suspect_events.map((ev) => (
                <div key={ev.record_id} className="border border-gray-200 rounded-lg p-4 text-xs space-y-3 bg-gray-50/50">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 pb-2">
                    <div className="flex items-center gap-2">
                      <span className="bg-gray-800 text-white font-bold px-2 py-0.5 rounded text-[10px]">
                        Event #{ev.event_index}
                      </span>
                      <span className="font-bold text-gray-900 font-mono">{ev.event_timestamp}</span>
                      <span className="bg-blue-100 text-blue-700 font-medium px-2 py-0.5 rounded text-[10px]">
                        {ev.call_type} ({formatSeconds(ev.duration)})
                      </span>
                    </div>
                    <div className="font-mono text-gray-700 text-xs">
                      Tower: <strong className="text-indigo-700">{ev.cell_tower_id}</strong>
                      {ev.cell_sector_id && <span> | Sector: {ev.cell_sector_id}</span>}
                    </div>
                  </div>

                  {ev.location && (
                    <div className="text-[11px] text-gray-500">
                      Physical Location: <strong>{ev.location}</strong>
                    </div>
                  )}

                  {/* Co-located candidates at this event */}
                  <div>
                    <span className="text-[11px] font-semibold text-gray-600 block mb-1">
                      Co-located Candidates Observed within ±{towerResults.configured_time_window_minutes}m:
                    </span>
                    {ev.candidate_records.length === 0 ? (
                      <p className="text-[11px] text-gray-400 italic">No other mobile lines observed around this tower event.</p>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                        {ev.candidate_records.map((c, i) => (
                          <div key={i} className="bg-white border border-gray-200 rounded p-2 text-[11px] space-y-0.5">
                            <div className="font-mono font-bold text-blue-700">{c.candidate_number}</div>
                            <div className="text-gray-500">
                              Time: <span className="font-mono text-gray-700">{c.candidate_call_time.slice(11, 19)}</span>
                            </div>
                            <div className="text-gray-500">
                              Offset: <span className="font-semibold text-indigo-700">{c.time_offset_minutes > 0 ? `+${c.time_offset_minutes}` : c.time_offset_minutes}m</span> ({c.candidate_call_type})
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* MODAL: INSPECT CANDIDATE SUPPORTING EVIDENCE */}
      {inspectedCandidate && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg border border-gray-200 max-w-2xl w-full p-5 shadow-xl max-h-[85vh] overflow-y-auto space-y-4">
            <div className="flex justify-between items-center border-b border-gray-100 pb-3">
              <div>
                <h3 className="text-sm font-bold text-gray-900">
                  Candidate Co-Location Records: {inspectedCandidate.candidate_number}
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  Rank #{inspectedCandidate.rank} | Matched {inspectedCandidate.matched_events_count} of {inspectedCandidate.total_suspect_events} events ({inspectedCandidate.match_percentage}%)
                </p>
              </div>
              <button
                onClick={() => setInspectedCandidate(null)}
                className="text-gray-400 hover:text-gray-600 font-bold text-sm cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="p-3 bg-amber-50 border border-amber-200 rounded text-xs text-amber-800">
              <strong>Notice:</strong> {inspectedCandidate.classification}. Physical tower co-location is an analytical indicator and requires independent forensic verification.
            </div>

            <div className="overflow-x-auto border border-gray-200 rounded">
              <table className="w-full text-left text-xs">
                <thead className="bg-gray-50 border-b border-gray-200 text-gray-500 uppercase font-medium">
                  <tr>
                    <th className="px-3 py-2">Event #</th>
                    <th className="px-3 py-2">Tower ID</th>
                    <th className="px-3 py-2">Suspect Call Time</th>
                    <th className="px-3 py-2">Candidate Call Time</th>
                    <th className="px-3 py-2">Offset</th>
                    <th className="px-3 py-2">Type</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 font-mono text-[11px]">
                  {inspectedCandidate.supporting_events.map((se, i) => (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="px-3 py-2 font-bold text-gray-700">#{se.event_index}</td>
                      <td className="px-3 py-2 text-indigo-700 font-semibold">{se.tower_id}</td>
                      <td className="px-3 py-2 text-gray-700">{se.suspect_time}</td>
                      <td className="px-3 py-2 text-gray-900 font-bold">{se.candidate_time}</td>
                      <td className="px-3 py-2 text-indigo-700">
                        {se.time_offset_minutes > 0 ? `+${se.time_offset_minutes}` : se.time_offset_minutes}m
                      </td>
                      <td className="px-3 py-2 text-gray-600">{se.candidate_call_type || "Voice"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end pt-3 border-t border-gray-100">
              <button
                type="button"
                onClick={() => setInspectedCandidate(null)}
                className="px-4 py-1.5 bg-gray-800 hover:bg-gray-900 text-white rounded text-xs font-medium cursor-pointer"
              >
                Close Records Inspection
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
