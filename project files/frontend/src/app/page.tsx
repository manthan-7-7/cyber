"use client";

import { useEffect, useState, useMemo } from "react";
import { Case, CaseCreateInput, CasePriority, CaseStatus, CaseUpdateInput, AuthUser, EvidenceItem } from "@/types/case";
import {
  clearSession,
  createCase,
  deleteCase,
  deleteCaseEvidence,
  fetchCaseById,
  fetchCaseEvidence,
  fetchCases,
  getEvidenceDownloadUrl,
  getSavedToken,
  getSavedUser,
  loginUser,
  saveToken,
  saveUser,
  updateCase,
  uploadCaseEvidence,
  verifySession,
} from "@/lib/api";
import CDRAnalysisView from "./components/CDRAnalysisView";

type Tab = "dashboard" | "cases" | "details" | "evidence" | "cdr";

export default function Home() {
  const [activeTab, setActiveTab] = useState<Tab>("dashboard");
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);

  // Cases state
  const [cases, setCases] = useState<Case[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [selectedCase, setSelectedCase] = useState<Case | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Evidence state
  const [evidenceList, setEvidenceList] = useState<EvidenceItem[]>([]);
  const [isLoadingEvidence, setIsLoadingEvidence] = useState<boolean>(false);
  const [evidenceError, setEvidenceError] = useState<string | null>(null);
  const [evidenceSuccess, setEvidenceSuccess] = useState<string | null>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadDescription, setUploadDescription] = useState<string>("");
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [copiedHashId, setCopiedHashId] = useState<string | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>("All");
  const [priorityFilter, setPriorityFilter] = useState<string>("All");
  const [searchQuery, setSearchQuery] = useState<string>("");

  // Modals
  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
  const [showEditModal, setShowEditModal] = useState<boolean>(false);
  const [showAuthModal, setShowAuthModal] = useState<boolean>(false);
  const [showDeleteCaseModal, setShowDeleteCaseModal] = useState<boolean>(false);
  const [isDeletingCase, setIsDeletingCase] = useState<boolean>(false);
  const [deleteCaseError, setDeleteCaseError] = useState<string | null>(null);

  // Create Form State
  const [createForm, setCreateForm] = useState<CaseCreateInput>({
    title: "",
    description: "",
    case_type: "General",
    status: "Open",
    priority: "Medium",
  });

  // Edit Form State
  const [editForm, setEditForm] = useState<CaseUpdateInput>({});

  // Auth Form State
  const [authMode, setAuthMode] = useState<"login" | "token">("login");
  const [authEmail, setAuthEmail] = useState<string>("investigator_test@example.com");
  const [authPassword, setAuthPassword] = useState<string>("TestPassword123!");
  const [manualToken, setManualToken] = useState<string>("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [isSubmittingAuth, setIsSubmittingAuth] = useState<boolean>(false);

  // Load session from local storage and verify with backend on mount
  useEffect(() => {
    const initSession = async () => {
      await Promise.resolve();
      const savedToken = getSavedToken();
      const savedUser = getSavedUser();
      if (savedToken) {
        setToken(savedToken);
        setUser(savedUser);
        try {
          const res = await verifySession(savedToken);
          setUser(res.user);
          saveUser(res.user);
        } catch {
          clearSession();
          setToken(null);
          setUser(null);
        }
      }
    };
    initSession();
  }, []);

  // Fetch cases when token changes or when refreshed
  const loadCases = async (authToken?: string) => {
    const currentToken = authToken || token;
    if (!currentToken) {
      setCases([]);
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const data = await fetchCases(currentToken);
      setCases(data);
      if (data.length > 0 && !selectedCaseId) {
        setSelectedCaseId(data[0].id);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to load cases.";
      setError(msg);
      if (msg.includes("401")) {
        setToken(null);
        clearSession();
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!token) return;
    const fetchOnToken = async () => {
      await Promise.resolve();
      loadCases(token);
    };
    fetchOnToken();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Load evidence for a specific case
  const loadEvidence = async (caseId: string, authToken?: string) => {
    const currentToken = authToken || token;
    if (!currentToken || !caseId) {
      setEvidenceList([]);
      return;
    }
    setIsLoadingEvidence(true);
    setEvidenceError(null);
    try {
      const data = await fetchCaseEvidence(currentToken, caseId);
      setEvidenceList(data);
    } catch (err: unknown) {
      setEvidenceError(err instanceof Error ? err.message : "Failed to load evidence.");
    } finally {
      setIsLoadingEvidence(false);
    }
  };

  // Load case details and evidence when selectedCaseId changes
  useEffect(() => {
    let isMounted = true;
    const loadDetailsAndEvidence = async () => {
      await Promise.resolve();
      if (!isMounted) return;
      if (!token || !selectedCaseId) {
        setSelectedCase(null);
        setEvidenceList([]);
        return;
      }

      setIsLoading(true);
      setError(null);
      try {
        const data = await fetchCaseById(token, selectedCaseId);
        if (isMounted) setSelectedCase(data);
      } catch (err: unknown) {
        if (isMounted) setError(err instanceof Error ? err.message : "Failed to load case details.");
      } finally {
        if (isMounted) setIsLoading(false);
      }

      loadEvidence(selectedCaseId, token);
    };

    loadDetailsAndEvidence();

    return () => {
      isMounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCaseId, token]);

  // Handle Authentication
  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmittingAuth(true);
    setAuthError(null);

    try {
      if (authMode === "login") {
        const res = await loginUser(authEmail, authPassword);
        saveToken(res.access_token);
        saveUser(res.user);
        setToken(res.access_token);
        setUser(res.user);
        setShowAuthModal(false);
        loadCases(res.access_token);
      } else {
        const clean = manualToken.trim();
        if (!clean) throw new Error("Please enter a valid Bearer token.");
        saveToken(clean);
        setToken(clean);
        setShowAuthModal(false);
        loadCases(clean);
      }
    } catch (err: unknown) {
      setAuthError(err instanceof Error ? err.message : "Authentication error.");
    } finally {
      setIsSubmittingAuth(false);
    }
  };

  const handleLogout = () => {
    clearSession();
    setToken(null);
    setUser(null);
    setCases([]);
    setSelectedCase(null);
    setEvidenceList([]);
    setActiveTab("dashboard");
  };

  // Handle Create Case
  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) {
      setShowAuthModal(true);
      return;
    }
    if (!createForm.title.trim()) {
      alert("Case title is required.");
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const created = await createCase(token, createForm);
      setCases((prev) => [created, ...prev]);
      setShowCreateModal(false);
      setCreateForm({
        title: "",
        description: "",
        case_type: "General",
        status: "Open",
        priority: "Medium",
      });
      setSelectedCaseId(created.id);
      setSelectedCase(created);
      setActiveTab("details");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create case.");
    } finally {
      setIsLoading(false);
    }
  };

  // Handle Edit Case
  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !selectedCaseId) return;

    setIsLoading(true);
    setError(null);
    try {
      const updated = await updateCase(token, selectedCaseId, editForm);
      setSelectedCase(updated);
      setCases((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      setShowEditModal(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to update case.");
    } finally {
      setIsLoading(false);
    }
  };

  // Open Edit Modal with current values
  const openEditModal = (targetCase: Case) => {
    setEditForm({
      title: targetCase.title,
      description: targetCase.description || "",
      case_type: targetCase.case_type || "General",
      status: targetCase.status,
      priority: targetCase.priority,
    });
    setSelectedCaseId(targetCase.id);
    setSelectedCase(targetCase);
    setShowEditModal(true);
  };

  // Handle Archive Case (Sets status to Closed)
  const handleArchiveCase = async () => {
    if (!token || !selectedCaseId) return;
    setIsDeletingCase(true);
    setDeleteCaseError(null);
    try {
      const updated = await updateCase(token, selectedCaseId, { status: "Closed" });
      setSelectedCase(updated);
      setCases((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      setShowDeleteCaseModal(false);
    } catch (err: unknown) {
      setDeleteCaseError(err instanceof Error ? err.message : "Failed to archive case.");
    } finally {
      setIsDeletingCase(false);
    }
  };

  // Handle Permanent Delete Case
  const handlePermanentDeleteCase = async () => {
    if (!token || !selectedCaseId) return;
    setIsDeletingCase(true);
    setDeleteCaseError(null);
    try {
      await deleteCase(token, selectedCaseId);
      const remainingCases = cases.filter((c) => c.id !== selectedCaseId);
      setCases(remainingCases);
      setSelectedCaseId(remainingCases.length > 0 ? remainingCases[0].id : null);
      setSelectedCase(remainingCases.length > 0 ? remainingCases[0] : null);
      setShowDeleteCaseModal(false);
      setActiveTab("cases");
    } catch (err: unknown) {
      setDeleteCaseError(err instanceof Error ? err.message : "Failed to delete case.");
    } finally {
      setIsDeletingCase(false);
    }
  };

  // Handle Evidence Upload
  const handleUploadEvidence = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !selectedCaseId || !uploadFile) return;

    if (uploadFile.size > 10 * 1024 * 1024) {
      setEvidenceError("File exceeds maximum allowed size of 10 MB.");
      return;
    }

    setIsUploading(true);
    setEvidenceError(null);
    setEvidenceSuccess(null);

    try {
      const newEv = await uploadCaseEvidence(token, selectedCaseId, uploadFile, uploadDescription);
      setEvidenceList((prev) => [newEv, ...prev]);
      setEvidenceSuccess(`Evidence "${newEv.file_name}" uploaded successfully. SHA-256 hash verified.`);
      setUploadFile(null);
      setUploadDescription("");
      const fileInput = document.getElementById("evidence-file-input") as HTMLInputElement;
      if (fileInput) fileInput.value = "";
    } catch (err: unknown) {
      setEvidenceError(err instanceof Error ? err.message : "Evidence upload failed.");
    } finally {
      setIsUploading(false);
    }
  };

  // Handle Evidence Download
  const handleDownloadEvidence = async (ev: EvidenceItem) => {
    if (!token || !selectedCaseId) return;
    setDownloadingId(ev.id);
    setEvidenceError(null);
    try {
      const res = await getEvidenceDownloadUrl(token, selectedCaseId, ev.id);
      const link = document.createElement("a");
      link.href = res.download_url;
      link.download = res.file_name;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err: unknown) {
      setEvidenceError(err instanceof Error ? err.message : "Failed to generate download URL.");
    } finally {
      setDownloadingId(null);
    }
  };

  // Handle Evidence Delete
  const handleDeleteEvidence = async (ev: EvidenceItem) => {
    if (!token || !selectedCaseId) return;
    if (
      !confirm(
        `Are you sure you want to delete evidence "${ev.file_name}"? This removes the storage object and records the deletion in audit history.`
      )
    ) {
      return;
    }

    setIsLoadingEvidence(true);
    setEvidenceError(null);
    setEvidenceSuccess(null);
    try {
      await deleteCaseEvidence(token, selectedCaseId, ev.id);
      setEvidenceList((prev) => prev.filter((item) => item.id !== ev.id));
      setEvidenceSuccess(`Evidence "${ev.file_name}" deleted and recorded in audit log.`);
    } catch (err: unknown) {
      setEvidenceError(err instanceof Error ? err.message : "Failed to delete evidence.");
    } finally {
      setIsLoadingEvidence(false);
    }
  };

  // Copy hash helper
  const copyHash = (hash: string, id: string) => {
    navigator.clipboard.writeText(hash);
    setCopiedHashId(id);
    setTimeout(() => setCopiedHashId(null), 2000);
  };

  // Format file size
  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  // Filtered cases for the Cases tab
  const filteredCases = useMemo(() => {
    return cases.filter((c) => {
      const matchesStatus = statusFilter === "All" || c.status === statusFilter;
      const matchesPriority = priorityFilter === "All" || c.priority === priorityFilter;
      const matchesSearch =
        !searchQuery.trim() ||
        c.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (c.case_type && c.case_type.toLowerCase().includes(searchQuery.toLowerCase()));
      return matchesStatus && matchesPriority && matchesSearch;
    });
  }, [cases, statusFilter, priorityFilter, searchQuery]);

  // Real dashboard metrics
  const stats = useMemo(() => {
    return {
      total: cases.length,
      open: cases.filter((c) => c.status === "Open").length,
      inProgress: cases.filter((c) => c.status === "In Progress").length,
      closed: cases.filter((c) => c.status === "Closed").length,
    };
  }, [cases]);

  // Badge helpers
  const getStatusBadge = (status: CaseStatus) => {
    switch (status) {
      case "Open":
        return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200">Open</span>;
      case "In Progress":
        return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">In Progress</span>;
      case "Closed":
        return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700 border border-gray-300">Closed</span>;
    }
  };

  const getPriorityBadge = (priority: CasePriority) => {
    switch (priority) {
      case "High":
        return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-50 text-red-700 border border-red-200">High</span>;
      case "Medium":
        return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-50 text-yellow-800 border border-yellow-200">Medium</span>;
      case "Low":
        return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-50 text-green-700 border border-green-200">Low</span>;
    }
  };

  // Reusable Evidence Section Component
  const renderEvidenceSection = () => (
    <div className="bg-white border border-gray-200 rounded-lg p-5 shadow-xs space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 pb-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Case Evidence & Documents</h3>
          <p className="text-xs text-gray-500">
            Forensic artifacts stored in private <code className="bg-gray-100 px-1 py-0.5 rounded text-gray-700">case-evidence</code> bucket
          </p>
        </div>
        <span className="text-xs bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded font-medium">
          {evidenceList.length} Item{evidenceList.length === 1 ? "" : "s"}
        </span>
      </div>

      {/* Notifications */}
      {evidenceSuccess && (
        <div className="p-3 bg-green-50 border border-green-200 rounded text-xs text-green-800 flex justify-between items-center">
          <span>{evidenceSuccess}</span>
          <button onClick={() => setEvidenceSuccess(null)} className="text-green-600 hover:text-green-800 font-bold ml-2">
            ✕
          </button>
        </div>
      )}

      {evidenceError && (
        <div className="p-3 bg-red-50 border border-red-200 rounded text-xs text-red-800 flex justify-between items-center">
          <span>{evidenceError}</span>
          <button onClick={() => setEvidenceError(null)} className="text-red-600 hover:text-red-800 font-bold ml-2">
            ✕
          </button>
        </div>
      )}

      {/* Upload Form */}
      <form onSubmit={handleUploadEvidence} className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-3">
        <h4 className="text-xs font-semibold text-gray-800 uppercase tracking-wide">Upload Forensic Evidence</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
          <div>
            <label className="block text-gray-700 font-medium mb-1">
              Select Document or Artifact <span className="text-red-500">*</span>
            </label>
            <input
              id="evidence-file-input"
              type="file"
              required
              accept=".pdf,.txt,.csv,.eml,.docx,.doc"
              onChange={(e) => {
                if (e.target.files && e.target.files[0]) {
                  setUploadFile(e.target.files[0]);
                }
              }}
              className="w-full text-xs text-gray-600 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-xs file:font-medium file:bg-blue-600 file:text-white hover:file:bg-blue-700 cursor-pointer"
            />
            <p className="text-[11px] text-gray-500 mt-1">
              Allowed: PDF, TXT, CSV, EML, DOCX, DOC (Max: 10 MB)
            </p>
          </div>
          <div>
            <label className="block text-gray-700 font-medium mb-1">Source / Artifact Description</label>
            <input
              type="text"
              placeholder="e.g. Memory dump extraction, phishing attachment log"
              value={uploadDescription}
              onChange={(e) => setUploadDescription(e.target.value)}
              className="w-full px-3 py-1.5 border border-gray-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white"
            />
          </div>
        </div>
        <div className="flex justify-end pt-2 border-t border-gray-200">
          <button
            type="submit"
            disabled={isUploading || !uploadFile}
            className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded text-xs font-medium flex items-center gap-1.5 cursor-pointer"
          >
            {isUploading ? (
              <>
                <svg className="w-3.5 h-3.5 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Hashing & Uploading...
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                Upload Evidence
              </>
            )}
          </button>
        </div>
      </form>

      {/* Evidence Table */}
      <div className="overflow-x-auto border border-gray-200 rounded-lg">
        <table className="w-full text-left text-xs">
          <thead className="bg-gray-50 border-b border-gray-200 text-gray-500 uppercase font-medium">
            <tr>
              <th className="px-4 py-3">File Name</th>
              <th className="px-4 py-3">Size</th>
              <th className="px-4 py-3">Format</th>
              <th className="px-4 py-3">SHA-256 Hash</th>
              <th className="px-4 py-3">Uploaded</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoadingEvidence ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                  <div className="flex items-center justify-center gap-2">
                    <svg className="w-4 h-4 animate-spin text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    <span>Loading forensic evidence...</span>
                  </div>
                </td>
              </tr>
            ) : evidenceList.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                  No evidence uploaded for this case yet. Select an artifact using the form above.
                </td>
              </tr>
            ) : (
              evidenceList.map((ev) => (
                <tr key={ev.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900">{ev.file_name}</div>
                    {ev.description && <p className="text-[11px] text-gray-400 truncate max-w-xs">{ev.description}</p>}
                  </td>
                  <td className="px-4 py-3 text-gray-600 font-mono text-[11px]">
                    {formatBytes(ev.file_size)}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    <span className="bg-gray-100 text-gray-700 px-1.5 py-0.5 rounded text-[11px] font-mono">
                      {ev.mime_type || "document"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {ev.sha256_hash ? (
                      <div className="flex items-center gap-1.5">
                        <code className="text-[11px] text-gray-700 font-mono bg-gray-50 border border-gray-200 px-1 py-0.5 rounded truncate max-w-[150px]" title={ev.sha256_hash}>
                          {ev.sha256_hash.slice(0, 10)}...{ev.sha256_hash.slice(-6)}
                        </code>
                        <button
                          type="button"
                          onClick={() => copyHash(ev.sha256_hash!, ev.id)}
                          className="text-[10px] text-blue-600 hover:text-blue-800 font-medium px-1.5 py-0.5 border border-gray-200 rounded bg-white hover:bg-gray-50 cursor-pointer"
                          title="Copy Full SHA-256 Hash"
                        >
                          {copiedHashId === ev.id ? "Copied" : "Copy"}
                        </button>
                      </div>
                    ) : (
                      <span className="text-gray-400 italic">None</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-500 font-mono text-[11px]">
                    {new Date(ev.uploaded_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-right space-x-2">
                    <button
                      type="button"
                      onClick={() => handleDownloadEvidence(ev)}
                      disabled={downloadingId === ev.id}
                      className="text-blue-600 hover:text-blue-800 font-medium cursor-pointer text-xs"
                      title="Download with temporary 60-second signed URL"
                    >
                      {downloadingId === ev.id ? "Generating..." : "Download"}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteEvidence(ev)}
                      className="text-red-600 hover:text-red-800 font-medium cursor-pointer text-xs"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen bg-gray-50 text-gray-900 font-sans antialiased overflow-hidden">
      {/* ==================================================================== */}
      {/* 1. SIDEBAR                                                           */}
      {/* ==================================================================== */}
      <aside className="w-64 bg-white border-r border-gray-200 flex flex-col justify-between shrink-0">
        <div>
          {/* Platform Branding */}
          <div className="p-5 border-b border-gray-200">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded bg-blue-600 text-white font-bold flex items-center justify-center text-sm">
                CF
              </div>
              <div>
                <h1 className="text-sm font-semibold tracking-tight text-gray-900">Cyber Forensics</h1>
                <p className="text-xs text-gray-500">Module 1: Case & Evidence</p>
              </div>
            </div>
          </div>

          {/* Navigation Items */}
          <nav className="p-3 space-y-1">
            <button
              onClick={() => setActiveTab("dashboard")}
              className={`w-full flex items-center justify-between px-3 py-2 text-sm font-medium rounded-md transition-colors ${activeTab === "dashboard"
                ? "bg-blue-50 text-blue-700 font-semibold"
                : "text-gray-700 hover:bg-gray-100"
                }`}
            >
              <span className="flex items-center gap-2.5">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                </svg>
                Dashboard
              </span>
            </button>

            <button
              onClick={() => setActiveTab("cases")}
              className={`w-full flex items-center justify-between px-3 py-2 text-sm font-medium rounded-md transition-colors ${activeTab === "cases"
                ? "bg-blue-50 text-blue-700 font-semibold"
                : "text-gray-700 hover:bg-gray-100"
                }`}
            >
              <span className="flex items-center gap-2.5">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
                Cases
              </span>
              <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full font-mono">
                {cases.length}
              </span>
            </button>

            {/* Evidence Sidebar Item: NOW ACTIVE AND FUNCTIONAL */}
            <button
              onClick={() => {
                if (cases.length > 0 && !selectedCaseId) {
                  setSelectedCaseId(cases[0].id);
                }
                setActiveTab("evidence");
              }}
              className={`w-full flex items-center justify-between px-3 py-2 text-sm font-medium rounded-md transition-colors ${activeTab === "evidence"
                ? "bg-blue-50 text-blue-700 font-semibold"
                : "text-gray-700 hover:bg-gray-100"
                }`}
            >
              <span className="flex items-center gap-2.5">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                </svg>
                Evidence
              </span>
              <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-medium">
                Active
              </span>
            </button>

            {/* CDR Analysis Sidebar Item: Module 2 */}
            <button
              onClick={() => {
                if (cases.length > 0 && !selectedCaseId) {
                  setSelectedCaseId(cases[0].id);
                }
                setActiveTab("cdr");
              }}
              className={`w-full flex items-center justify-between px-3 py-2 text-sm font-medium rounded-md transition-colors ${activeTab === "cdr"
                ? "bg-blue-50 text-blue-700 font-semibold"
                : "text-gray-700 hover:bg-gray-100"
                }`}
            >
              <span className="flex items-center gap-2.5">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0" />
                </svg>
                CDR Analysis
              </span>
              <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-medium">
                Module 2
              </span>
            </button>

            <div className="pt-3 pb-1 px-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">
              Forensic Modules
            </div>

            <div className="w-full flex items-center justify-between px-3 py-2 text-sm text-gray-400 rounded-md cursor-not-allowed">
              <span className="flex items-center gap-2.5">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
                Chain of Custody
              </span>
              <span className="text-[10px] bg-gray-100 text-gray-400 px-1.5 py-0.5 rounded border border-gray-200">
                Coming soon
              </span>
            </div>

            <div className="w-full flex items-center justify-between px-3 py-2 text-sm text-gray-400 rounded-md cursor-not-allowed">
              <span className="flex items-center gap-2.5">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Audit Logs
              </span>
              <span className="text-[10px] bg-gray-100 text-gray-400 px-1.5 py-0.5 rounded border border-gray-200">
                Coming soon
              </span>
            </div>
          </nav>
        </div>

        {/* Sidebar Footer: Session Status */}
        <div className="p-3 border-t border-gray-200 bg-gray-50">
          {token ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-green-500"></span>
                  <span className="text-xs font-medium text-gray-700">Authenticated</span>
                </div>
                <button
                  onClick={handleLogout}
                  className="text-xs text-red-600 hover:text-red-800 font-medium cursor-pointer"
                >
                  Log Out
                </button>
              </div>
              <p className="text-[11px] text-gray-500 truncate" title={user?.email || "Connected via Token"}>
                {user?.email || "Bearer Token Active"}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs text-amber-700">
                <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                <span>Session Required</span>
              </div>
              <button
                onClick={() => {
                  setAuthError(null);
                  setShowAuthModal(true);
                }}
                className="w-full py-1.5 px-3 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-medium transition-colors cursor-pointer text-center"
              >
                Sign In / Connect
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* ==================================================================== */}
      {/* 2. MAIN CONTENT AREA                                                 */}
      {/* ==================================================================== */}
      <main className="flex-1 flex flex-col min-w-0 overflow-y-auto">
        {/* Top Header */}
        <header className="h-14 bg-white border-b border-gray-200 px-6 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-gray-800 uppercase tracking-wide">
              {activeTab === "dashboard"
                ? "Investigation Dashboard"
                : activeTab === "cases"
                  ? "Case Management"
                  : activeTab === "evidence"
                    ? "Evidence Management Hub"
                    : activeTab === "cdr"
                      ? "CDR Analysis & Suspect Identification"
                      : "Case Record"}
            </span>
            {selectedCaseId && (activeTab === "details" || activeTab === "evidence" || activeTab === "cdr") && (
              <span className="text-xs text-gray-500 font-mono bg-gray-100 px-2 py-0.5 rounded">
                Case ID: {selectedCaseId.slice(0, 8)}...
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            {token && (
              <button
                onClick={() => {
                  loadCases();
                  if (selectedCaseId) loadEvidence(selectedCaseId);
                }}
                disabled={isLoading}
                className="p-1.5 text-gray-600 hover:text-gray-900 border border-gray-200 rounded-md hover:bg-gray-50 text-xs flex items-center gap-1.5 cursor-pointer"
                title="Refresh from Database"
              >
                <svg className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Refresh
              </button>
            )}

            <button
              onClick={() => {
                if (!token) {
                  setShowAuthModal(true);
                } else {
                  setShowCreateModal(true);
                }
              }}
              className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium px-3 py-1.5 rounded-md flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
              </svg>
              Create Case
            </button>
          </div>
        </header>

        {/* Unauthenticated Alert Banner */}
        {!token && (
          <div className="bg-amber-50 border-b border-amber-200 px-6 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <svg className="w-5 h-5 text-amber-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <p className="text-xs text-amber-800">
                <strong className="font-semibold">Authentication Required:</strong> All case and evidence operations require a verified Supabase session. Connect with your investigator credentials to view live cases.
              </p>
            </div>
            <button
              onClick={() => {
                setAuthError(null);
                setShowAuthModal(true);
              }}
              className="text-xs bg-amber-600 hover:bg-amber-700 text-white font-medium px-3 py-1 rounded transition-colors cursor-pointer"
            >
              Authenticate Now
            </button>
          </div>
        )}

        {/* Global Error Notice */}
        {error && (
          <div className="bg-red-50 border-b border-red-200 px-6 py-2.5 text-xs text-red-700 flex items-center justify-between">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="text-red-500 hover:text-red-800 font-bold ml-4">
              ✕
            </button>
          </div>
        )}

        {/* Page Content Viewport */}
        <div className="p-6">
          {/* TAB 1: DASHBOARD VIEW */}
          {activeTab === "dashboard" && (
            <div className="space-y-6 max-w-6xl">
              {/* Metrics Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-xs">
                  <div className="text-xs font-medium text-gray-500">Total Cases</div>
                  <div className="text-2xl font-bold text-gray-900 mt-1">{stats.total}</div>
                  <div className="text-[11px] text-gray-400 mt-1">Authorized database records</div>
                </div>

                <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-xs">
                  <div className="text-xs font-medium text-blue-600">Open Cases</div>
                  <div className="text-2xl font-bold text-gray-900 mt-1">{stats.open}</div>
                  <div className="text-[11px] text-gray-400 mt-1">Pending initial review</div>
                </div>

                <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-xs">
                  <div className="text-xs font-medium text-amber-600">In Progress</div>
                  <div className="text-2xl font-bold text-gray-900 mt-1">{stats.inProgress}</div>
                  <div className="text-[11px] text-gray-400 mt-1">Active investigation</div>
                </div>

                <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-xs">
                  <div className="text-xs font-medium text-gray-600">Closed Cases</div>
                  <div className="text-2xl font-bold text-gray-900 mt-1">{stats.closed}</div>
                  <div className="text-[11px] text-gray-400 mt-1">Completed inquiries</div>
                </div>
              </div>

              {/* Recent Cases Section */}
              <div className="bg-white border border-gray-200 rounded-lg shadow-xs">
                <div className="p-4 border-b border-gray-200 flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-semibold text-gray-900">Recent Investigations</h2>
                    <p className="text-xs text-gray-500">Latest active cases from PostgreSQL</p>
                  </div>
                  <button
                    onClick={() => setActiveTab("cases")}
                    className="text-xs text-blue-600 hover:text-blue-800 font-medium cursor-pointer"
                  >
                    View All Cases →
                  </button>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-gray-50 border-b border-gray-200 text-gray-500 uppercase font-medium">
                      <tr>
                        <th className="px-4 py-3">Case Title</th>
                        <th className="px-4 py-3">Type</th>
                        <th className="px-4 py-3">Status</th>
                        <th className="px-4 py-3">Priority</th>
                        <th className="px-4 py-3">Created</th>
                        <th className="px-4 py-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {cases.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                            {token ? "No cases found in database. Create your first investigation case." : "Please authenticate to view recent cases."}
                          </td>
                        </tr>
                      ) : (
                        cases.slice(0, 5).map((c) => (
                          <tr key={c.id} className="hover:bg-gray-50 transition-colors">
                            <td className="px-4 py-3 font-medium text-gray-900">{c.title}</td>
                            <td className="px-4 py-3 text-gray-600">{c.case_type || "General"}</td>
                            <td className="px-4 py-3">{getStatusBadge(c.status)}</td>
                            <td className="px-4 py-3">{getPriorityBadge(c.priority)}</td>
                            <td className="px-4 py-3 text-gray-500 font-mono text-[11px]">
                              {new Date(c.created_at).toLocaleDateString()}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <button
                                onClick={() => {
                                  setSelectedCaseId(c.id);
                                  setActiveTab("details");
                                }}
                                className="text-blue-600 hover:text-blue-800 font-medium cursor-pointer"
                              >
                                View Details
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: CASES LIST VIEW */}
          {activeTab === "cases" && (
            <div className="space-y-4 max-w-6xl">
              {/* Filter Bar */}
              <div className="bg-white border border-gray-200 rounded-lg p-3 flex flex-wrap items-center justify-between gap-3 shadow-xs">
                <div className="flex flex-wrap items-center gap-3 flex-1 min-w-[280px]">
                  {/* Search input */}
                  <div className="relative flex-1 min-w-[200px]">
                    <input
                      type="text"
                      placeholder="Search cases by title or type..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full pl-8 pr-3 py-1.5 text-xs border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                    <svg className="w-4 h-4 text-gray-400 absolute left-2.5 top-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                  </div>

                  {/* Status Dropdown */}
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className="text-xs border border-gray-300 rounded-md px-2.5 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="All">All Statuses</option>
                    <option value="Open">Open</option>
                    <option value="In Progress">In Progress</option>
                    <option value="Closed">Closed</option>
                  </select>

                  {/* Priority Dropdown */}
                  <select
                    value={priorityFilter}
                    onChange={(e) => setPriorityFilter(e.target.value)}
                    className="text-xs border border-gray-300 rounded-md px-2.5 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="All">All Priorities</option>
                    <option value="High">High</option>
                    <option value="Medium">Medium</option>
                    <option value="Low">Low</option>
                  </select>
                </div>

                <div className="text-xs text-gray-500 font-medium">
                  Showing {filteredCases.length} of {cases.length} cases
                </div>
              </div>

              {/* Cases Table */}
              <div className="bg-white border border-gray-200 rounded-lg overflow-hidden shadow-xs">
                <table className="w-full text-left text-xs">
                  <thead className="bg-gray-50 border-b border-gray-200 text-gray-500 uppercase font-medium">
                    <tr>
                      <th className="px-4 py-3">Case Title</th>
                      <th className="px-4 py-3">Classification</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Priority</th>
                      <th className="px-4 py-3">Created Date</th>
                      <th className="px-4 py-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filteredCases.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-12 text-center text-gray-400">
                          {cases.length === 0
                            ? "No cases found in database. Create your first investigation case."
                            : "No cases match the selected filter criteria."}
                        </td>
                      </tr>
                    ) : (
                      filteredCases.map((c) => (
                        <tr key={c.id} className="hover:bg-gray-50 transition-colors">
                          <td className="px-4 py-3">
                            <button
                              onClick={() => {
                                setSelectedCaseId(c.id);
                                setActiveTab("details");
                              }}
                              className="font-medium text-blue-600 hover:text-blue-800 text-left cursor-pointer"
                            >
                              {c.title}
                            </button>
                            {c.description && (
                              <p className="text-[11px] text-gray-400 truncate max-w-sm">{c.description}</p>
                            )}
                          </td>
                          <td className="px-4 py-3 text-gray-600">{c.case_type || "General"}</td>
                          <td className="px-4 py-3">{getStatusBadge(c.status)}</td>
                          <td className="px-4 py-3">{getPriorityBadge(c.priority)}</td>
                          <td className="px-4 py-3 text-gray-500 font-mono text-[11px]">
                            {new Date(c.created_at).toLocaleDateString()}
                          </td>
                          <td className="px-4 py-3 text-right space-x-2">
                            <button
                              onClick={() => {
                                setSelectedCaseId(c.id);
                                setActiveTab("details");
                              }}
                              className="text-gray-600 hover:text-gray-900 font-medium cursor-pointer"
                            >
                              Inspect
                            </button>
                            <button
                              onClick={() => openEditModal(c)}
                              className="text-blue-600 hover:text-blue-800 font-medium cursor-pointer"
                            >
                              Edit
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 3: CASE DETAILS VIEW */}
          {activeTab === "details" && selectedCase && (
            <div className="space-y-6 max-w-5xl">
              {/* Back navigation */}
              <div>
                <button
                  onClick={() => setActiveTab("cases")}
                  className="text-xs text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1 cursor-pointer"
                >
                  ← Back to Cases List
                </button>
              </div>

              {/* Case Header Card */}
              <div className="bg-white border border-gray-200 rounded-lg p-5 shadow-xs">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-100 pb-4">
                  <div>
                    <div className="flex items-center gap-2.5">
                      <h2 className="text-lg font-bold text-gray-900">{selectedCase.title}</h2>
                      {getStatusBadge(selectedCase.status)}
                      {getPriorityBadge(selectedCase.priority)}
                    </div>
                    <p className="text-xs text-gray-500 mt-1 font-mono">Case ID: {selectedCase.id}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        setSelectedCaseId(selectedCase.id);
                        setActiveTab("cdr");
                      }}
                      className="px-3 py-1.5 bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 rounded text-xs font-medium cursor-pointer flex items-center gap-1.5"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0" />
                      </svg>
                      CDR Analysis
                    </button>
                    <button
                      onClick={() => openEditModal(selectedCase)}
                      className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-medium cursor-pointer"
                    >
                      Edit Case
                    </button>
                    <button
                      onClick={() => {
                        setDeleteCaseError(null);
                        setShowDeleteCaseModal(true);
                      }}
                      className="px-3 py-1.5 bg-white hover:bg-red-50 text-red-600 border border-red-200 rounded text-xs font-medium cursor-pointer"
                    >
                      Delete / Archive
                    </button>
                  </div>
                </div>

                {/* Metadata Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-4 text-xs">
                  <div>
                    <span className="text-gray-400 block font-medium">Classification</span>
                    <span className="text-gray-800 font-semibold mt-0.5 block">{selectedCase.case_type || "General"}</span>
                  </div>
                  <div>
                    <span className="text-gray-400 block font-medium">Created By</span>
                    <span className="text-gray-800 font-mono text-[11px] mt-0.5 block truncate" title={selectedCase.created_by}>
                      {selectedCase.created_by}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-400 block font-medium">Date Created</span>
                    <span className="text-gray-800 mt-0.5 block">
                      {new Date(selectedCase.created_at).toLocaleString()}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-400 block font-medium">Last Modified</span>
                    <span className="text-gray-800 mt-0.5 block">
                      {new Date(selectedCase.updated_at).toLocaleString()}
                    </span>
                  </div>
                </div>

                {/* Case Description */}
                <div className="mt-5 pt-4 border-t border-gray-100">
                  <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Case Summary</h3>
                  <p className="text-xs text-gray-600 mt-1.5 leading-relaxed whitespace-pre-wrap">
                    {selectedCase.description || "No description provided for this case record."}
                  </p>
                </div>
              </div>

              {/* Case Evidence Management Section */}
              {renderEvidenceSection()}
            </div>
          )}

          {/* TAB 4: EVIDENCE MANAGEMENT HUB */}
          {activeTab === "evidence" && (
            <div className="space-y-6 max-w-5xl">
              {/* Case Selector Bar */}
              <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-xs flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <label className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Select Investigation Case:</label>
                  <select
                    value={selectedCaseId || ""}
                    onChange={(e) => setSelectedCaseId(e.target.value)}
                    className="text-xs border border-gray-300 rounded px-3 py-1.5 bg-white text-gray-800 font-medium focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    {cases.length === 0 ? (
                      <option value="">No cases available</option>
                    ) : (
                      cases.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.title} ({c.status})
                        </option>
                      ))
                    )}
                  </select>
                </div>

                {selectedCase && (
                  <button
                    onClick={() => setActiveTab("details")}
                    className="text-xs text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1 cursor-pointer"
                  >
                    View Complete Case Details →
                  </button>
                )}
              </div>

              {selectedCaseId ? (
                renderEvidenceSection()
              ) : (
                <div className="bg-white border border-gray-200 rounded-lg p-12 text-center text-gray-400">
                  <svg className="w-10 h-10 text-gray-300 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <p className="text-sm font-medium text-gray-600">No Case Selected</p>
                  <p className="text-xs text-gray-400 mt-1">Please create or select an investigation case to upload and inspect forensic evidence.</p>
                </div>
              )}
            </div>
          )}

          {/* TAB 5: CDR ANALYSIS & SUSPECT IDENTIFICATION (MODULE 2) */}
          {activeTab === "cdr" && (
            <CDRAnalysisView
              token={token}
              cases={cases}
              selectedCaseId={selectedCaseId}
              onSelectCaseId={(id) => setSelectedCaseId(id)}
              onRequestAuth={() => {
                setAuthError(null);
                setShowAuthModal(true);
              }}
            />
          )}
        </div>
      </main>

      {/* ==================================================================== */}
      {/* 3. MODALS (CREATE, EDIT, AUTH, DELETE/ARCHIVE)                       */}
      {/* ==================================================================== */}

      {/* CREATE CASE MODAL */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg border border-gray-200 max-w-md w-full p-5 shadow-lg">
            <div className="flex justify-between items-center border-b border-gray-100 pb-3">
              <h3 className="text-sm font-bold text-gray-900">Create Investigation Case</h3>
              <button onClick={() => setShowCreateModal(false)} className="text-gray-400 hover:text-gray-600 text-xs font-bold cursor-pointer">
                ✕
              </button>
            </div>
            <form onSubmit={handleCreateSubmit} className="space-y-3.5 mt-3 text-xs">
              <div>
                <label className="block text-gray-700 font-medium mb-1">
                  Case Title <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Ransomware Outbreak Incident"
                  value={createForm.title}
                  onChange={(e) => setCreateForm({ ...createForm, title: e.target.value })}
                  className="w-full px-3 py-1.5 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-gray-700 font-medium mb-1">Classification</label>
                  <input
                    type="text"
                    placeholder="e.g. Phishing / Malware"
                    value={createForm.case_type}
                    onChange={(e) => setCreateForm({ ...createForm, case_type: e.target.value })}
                    className="w-full px-3 py-1.5 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-gray-700 font-medium mb-1">Priority</label>
                  <select
                    value={createForm.priority}
                    onChange={(e) => setCreateForm({ ...createForm, priority: e.target.value as CasePriority })}
                    className="w-full px-3 py-1.5 border border-gray-300 rounded bg-white text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="Low">Low</option>
                    <option value="Medium">Medium</option>
                    <option value="High">High</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-gray-700 font-medium mb-1">Initial Status</label>
                <select
                  value={createForm.status}
                  onChange={(e) => setCreateForm({ ...createForm, status: e.target.value as CaseStatus })}
                  className="w-full px-3 py-1.5 border border-gray-300 rounded bg-white text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="Open">Open</option>
                  <option value="In Progress">In Progress</option>
                  <option value="Closed">Closed</option>
                </select>
              </div>

              <div>
                <label className="block text-gray-700 font-medium mb-1">Description</label>
                <textarea
                  rows={3}
                  placeholder="Summary of incident scope, systems affected, or initial findings..."
                  value={createForm.description}
                  onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
                  className="w-full px-3 py-1.5 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                ></textarea>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-3 py-1.5 border border-gray-300 rounded text-gray-700 hover:bg-gray-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isLoading}
                  className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded font-medium cursor-pointer"
                >
                  {isLoading ? "Saving..." : "Create Case"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* EDIT CASE MODAL */}
      {showEditModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg border border-gray-200 max-w-md w-full p-5 shadow-lg">
            <div className="flex justify-between items-center border-b border-gray-100 pb-3">
              <h3 className="text-sm font-bold text-gray-900">Edit Case Record</h3>
              <button onClick={() => setShowEditModal(false)} className="text-gray-400 hover:text-gray-600 text-xs font-bold cursor-pointer">
                ✕
              </button>
            </div>
            <form onSubmit={handleEditSubmit} className="space-y-3.5 mt-3 text-xs">
              <div>
                <label className="block text-gray-700 font-medium mb-1">Case Title</label>
                <input
                  type="text"
                  required
                  value={editForm.title || ""}
                  onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                  className="w-full px-3 py-1.5 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-gray-700 font-medium mb-1">Status</label>
                  <select
                    value={editForm.status}
                    onChange={(e) => setEditForm({ ...editForm, status: e.target.value as CaseStatus })}
                    className="w-full px-3 py-1.5 border border-gray-300 rounded bg-white text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="Open">Open</option>
                    <option value="In Progress">In Progress</option>
                    <option value="Closed">Closed</option>
                  </select>
                </div>
                <div>
                  <label className="block text-gray-700 font-medium mb-1">Priority</label>
                  <select
                    value={editForm.priority}
                    onChange={(e) => setEditForm({ ...editForm, priority: e.target.value as CasePriority })}
                    className="w-full px-3 py-1.5 border border-gray-300 rounded bg-white text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="Low">Low</option>
                    <option value="Medium">Medium</option>
                    <option value="High">High</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-gray-700 font-medium mb-1">Classification</label>
                <input
                  type="text"
                  value={editForm.case_type || ""}
                  onChange={(e) => setEditForm({ ...editForm, case_type: e.target.value })}
                  className="w-full px-3 py-1.5 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-gray-700 font-medium mb-1">Summary</label>
                <textarea
                  rows={3}
                  value={editForm.description || ""}
                  onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                  className="w-full px-3 py-1.5 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                ></textarea>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
                  className="px-3 py-1.5 border border-gray-300 rounded text-gray-700 hover:bg-gray-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isLoading}
                  className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded font-medium cursor-pointer"
                >
                  {isLoading ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* DELETE / ARCHIVE CASE MODAL */}
      {showDeleteCaseModal && selectedCase && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg border border-gray-200 max-w-md w-full p-5 shadow-lg space-y-4">
            <div className="flex justify-between items-center border-b border-gray-100 pb-3">
              <h3 className="text-sm font-bold text-gray-900">Delete or Archive Case</h3>
              <button
                onClick={() => setShowDeleteCaseModal(false)}
                className="text-gray-400 hover:text-gray-600 text-xs font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="space-y-2 text-xs text-gray-600">
              <p>
                <strong>Forensic Integrity Notice:</strong> Digital forensics standards require that cases containing evidence, custody logs, or audit records must not be permanently deleted.
              </p>
              <div className="p-3 bg-amber-50 border border-amber-200 rounded text-amber-800 space-y-1">
                <p className="font-semibold">Recommended Safe Action:</p>
                <p>
                  <strong>Archive (Close):</strong> Sets the case status to &quot;Closed&quot; while retaining all evidence, custody history, and audit trails intact.
                </p>
              </div>
            </div>

            {deleteCaseError && (
              <div className="p-2.5 bg-red-50 border border-red-200 rounded text-xs text-red-700">
                {deleteCaseError}
              </div>
            )}

            <div className="flex flex-col sm:flex-row justify-end gap-2 pt-2 border-t border-gray-100">
              <button
                type="button"
                onClick={() => setShowDeleteCaseModal(false)}
                className="px-3 py-1.5 border border-gray-300 rounded text-gray-700 hover:bg-gray-50 text-xs cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isDeletingCase}
                onClick={handleArchiveCase}
                className="px-3.5 py-1.5 bg-gray-700 hover:bg-gray-800 text-white rounded text-xs font-medium cursor-pointer"
              >
                {isDeletingCase ? "Processing..." : "Archive Case (Close)"}
              </button>
              <button
                type="button"
                disabled={isDeletingCase}
                onClick={handlePermanentDeleteCase}
                className="px-3.5 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded text-xs font-medium cursor-pointer"
              >
                {isDeletingCase ? "Deleting..." : "Permanently Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AUTHENTICATION MODAL */}
      {showAuthModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg border border-gray-200 max-w-sm w-full p-5 shadow-lg">
            <div className="flex justify-between items-center border-b border-gray-100 pb-3">
              <h3 className="text-sm font-bold text-gray-900">Investigator Authentication</h3>
              <button onClick={() => setShowAuthModal(false)} className="text-gray-400 hover:text-gray-600 text-xs font-bold cursor-pointer">
                ✕
              </button>
            </div>

            {/* Auth Mode Tabs */}
            <div className="flex border-b border-gray-200 mt-3 text-xs">
              <button
                type="button"
                onClick={() => setAuthMode("login")}
                className={`flex-1 py-1.5 text-center font-medium border-b-2 cursor-pointer ${authMode === "login"
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
                  }`}
              >
                Sign In Credentials
              </button>
              <button
                type="button"
                onClick={() => setAuthMode("token")}
                className={`flex-1 py-1.5 text-center font-medium border-b-2 cursor-pointer ${authMode === "token"
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
                  }`}
              >
                Direct Bearer Token
              </button>
            </div>

            {authError && (
              <div className="mt-3 p-2 bg-red-50 border border-red-200 rounded text-[11px] text-red-700">
                {authError}
              </div>
            )}

            <form onSubmit={handleLoginSubmit} className="space-y-3 mt-3 text-xs">
              {authMode === "login" ? (
                <>
                  <div>
                    <label className="block text-gray-700 font-medium mb-1">Investigator Email</label>
                    <input
                      type="email"
                      required
                      value={authEmail}
                      onChange={(e) => setAuthEmail(e.target.value)}
                      className="w-full px-3 py-1.5 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-gray-700 font-medium mb-1">Password</label>
                    <input
                      type="password"
                      required
                      value={authPassword}
                      onChange={(e) => setAuthPassword(e.target.value)}
                      className="w-full px-3 py-1.5 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                  <p className="text-[11px] text-gray-400">
                    Default dev account: <code className="bg-gray-100 px-1 py-0.5 rounded text-gray-600">investigator_test@example.com</code>
                  </p>
                </>
              ) : (
                <>
                  <div>
                    <label className="block text-gray-700 font-medium mb-1">Supabase Access Token (JWT)</label>
                    <textarea
                      rows={4}
                      required
                      placeholder="Paste your Bearer token here..."
                      value={manualToken}
                      onChange={(e) => setManualToken(e.target.value)}
                      className="w-full px-3 py-1.5 border border-gray-300 rounded font-mono text-[11px] focus:outline-none focus:ring-1 focus:ring-blue-500"
                    ></textarea>
                  </div>
                  <p className="text-[11px] text-gray-400">
                    Never shares the secret key. The token is sent in the <code className="text-gray-600">Authorization: Bearer</code> header.
                  </p>
                </>
              )}

              <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setShowAuthModal(false)}
                  className="px-3 py-1.5 border border-gray-300 rounded text-gray-700 hover:bg-gray-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingAuth}
                  className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded font-medium cursor-pointer"
                >
                  {isSubmittingAuth ? "Connecting..." : "Authenticate"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
