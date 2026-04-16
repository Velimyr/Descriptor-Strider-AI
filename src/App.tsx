import React, { useState, useEffect, useRef } from 'react';
import { 
  FolderPlus, 
  FileText, 
  Settings as SettingsIcon, 
  ArrowDown,
  ArrowUp,
  Play, 
  Trash2, 
  Plus, 
  X,
  Database,
  Search,
  Tag,
  AlertCircle,
  CheckCircle2,
  Loader2,
  FileJson,
  FileSpreadsheet,
  Upload,
  Terminal,
  FileUp,
  RotateCcw,
  Square
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Papa from 'papaparse';
import { cn } from './lib/utils';
import { Project, TableColumn, ArchivalRecord, ProcessingStatus, LogEntry, PageStatus, ColumnRole } from './types';
import {
  COLUMN_ROLE_LABELS,
  COLUMN_ROLE_OPTIONS,
  createColumn,
  createDefaultColumns,
  getColumnLabel,
  LEGACY_DEFAULT_COLUMNS,
  normalizeTableStructure,
} from './lib/tableColumns';
import { GeminiService } from './services/geminiService';
import { pdfStorage } from './services/pdfStorage';

// PDF.js worker setup
import * as pdfjs from 'pdfjs-dist';
pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

const normalizeColumnKey = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "");

const toCellValue = (value: unknown) => {
  if (value === null || value === undefined) return "";
  return typeof value === "string" ? value.trim() : String(value);
};

const formatDuration = (ms: number) => {
  if (ms < 1000) {
    return `${Math.round(ms)}мс`;
  }

  const seconds = ms / 1000;
  if (seconds < 60) {
    return `${seconds >= 10 ? seconds.toFixed(1) : seconds.toFixed(2)}с`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds - minutes * 60;
  return `${minutes}хв ${remainingSeconds >= 10 ? remainingSeconds.toFixed(0) : remainingSeconds.toFixed(1)}с`;
};

const formatBytes = (bytes: number) => {
  if (bytes < 1024) {
    return `${bytes} Б`;
  }

  const kilobytes = bytes / 1024;
  if (kilobytes < 1024) {
    return `${kilobytes.toFixed(1)} КБ`;
  }

  return `${(kilobytes / 1024).toFixed(2)} МБ`;
};

const getColumnValue = (
  data: Record<string, unknown> | undefined,
  column: TableColumn,
  aliases: string[] = []
) => {
  if (!data) return "";

  const directValue = data[column.id];
  if (directValue !== undefined && directValue !== null) {
    return toCellValue(directValue);
  }

  const labelValue = data[column.label];
  if (labelValue !== undefined && labelValue !== null) {
    return toCellValue(labelValue);
  }

  const targetKeys = new Set([
    normalizeColumnKey(column.id),
    normalizeColumnKey(column.label),
    ...aliases.map(alias => normalizeColumnKey(alias))
  ]);

  for (const alias of aliases) {
    const aliasValue = data[alias];
    if (aliasValue !== undefined && aliasValue !== null) {
      return toCellValue(aliasValue);
    }
  }

  for (const [key, value] of Object.entries(data)) {
    if (targetKeys.has(normalizeColumnKey(key))) {
      return toCellValue(value);
    }
  }

  return "";
};

const normalizeRecordData = (
  data: Record<string, unknown> | undefined,
  tableStructure: TableColumn[],
  sourceColumns: TableColumn[] = tableStructure
) => tableStructure.reduce<Record<string, string>>((acc, column, index) => {
  const sourceColumn = sourceColumns[index];
  const aliases = sourceColumn ? [sourceColumn.id, sourceColumn.label] : [];
  acc[column.id] = getColumnValue(data, column, aliases);
  return acc;
}, {});

const remapResultsToTableStructure = (
  results: ArchivalRecord[] | undefined,
  sourceColumns: TableColumn[],
  tableStructure: TableColumn[]
) => (results || []).map(record => ({
  ...record,
  data: normalizeRecordData(record.data, tableStructure, sourceColumns)
}));

const normalizeProject = (
  project: Project,
  resultsOverride?: ArchivalRecord[]
): { project: Project; results: ArchivalRecord[] } => {
  const sourceColumns = Array.isArray(project.tableStructure) && project.tableStructure.length > 0
    ? project.tableStructure
    : LEGACY_DEFAULT_COLUMNS;
  const tableStructure = normalizeTableStructure(sourceColumns);
  const sourceResults = resultsOverride ?? project.results ?? [];
  const results = remapResultsToTableStructure(sourceResults, sourceColumns, tableStructure);

  return {
    project: {
      ...project,
      tableStructure,
      results
    },
    results
  };
};

const getExportHeaders = (tableStructure: TableColumn[]) => [
  ...tableStructure.map((column, index) => getColumnLabel(column, index)),
  'Посилання на файл',
  'Сторінка',
  'Теги'
];

const getTitleColumn = (tableStructure: TableColumn[]) =>
  tableStructure.find(column => column.role === 'title');

export default function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [geminiKey, setGeminiKey] = useState<string>(localStorage.getItem('gemini_key') || '');
  const [geminiModel, setGeminiModel] = useState<string>(() => {
    const saved = localStorage.getItem('gemini_model');
    const validModels = ['gemini-3-flash-preview', 'gemini-3.1-pro-preview', 'gemini-flash-latest'];
    if (saved && validModels.includes(saved)) return saved;
    return 'gemini-3-flash-preview';
  });
  const geminiKeyRef = useRef(geminiKey);
  const geminiModelRef = useRef(geminiModel);

  useEffect(() => {
    geminiKeyRef.current = geminiKey;
  }, [geminiKey]);

  useEffect(() => {
    geminiModelRef.current = geminiModel;
  }, [geminiModel]);

  const [isProcessing, setIsProcessing] = useState(false);
  const [isIndexing, setIsIndexing] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const stopRef = useRef(false);
  const [processingStatus, setProcessingStatus] = useState<ProcessingStatus[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [googleAuthLoading, setGoogleAuthLoading] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [activeStatusTab, setActiveStatusTab] = useState<number>(0);

  useEffect(() => {
    console.log(`App mounted. Current geminiModel: ${geminiModel}`);
  }, []);

  const addLog = (message: string, level: LogEntry['level'] = 'info') => {
    const newLog: LogEntry = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      level,
      message
    };
    setLogs(prev => [newLog, ...prev].slice(0, 100));
    console.log(`[${level.toUpperCase()}] ${message}`);
  };

  const logDuration = (
    message: string,
    startedAt: number,
    warnThresholdMs: number = 15000
  ) => {
    const duration = performance.now() - startedAt;
    addLog(`${message} за ${formatDuration(duration)}`, duration >= warnThresholdMs ? 'warn' : 'info');
    return duration;
  };

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!isProcessing && !isIndexing) return;

      addLog(
        document.hidden
          ? "Вкладка браузера стала неактивною під час обробки. Browser throttling може сповільнювати canvas, таймери та мережеві запити."
          : "Вкладка браузера знову активна. Якщо перед цим була довга пауза, звірте її з новими таймінгами в логах.",
        document.hidden ? 'warn' : 'info'
      );
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [isProcessing, isIndexing]);

  const activeProject = projects.find(p => p.id === activeProjectId);

  // Sync processingStatus with active project
  useEffect(() => {
    if (activeProject) {
      setProcessingStatus(activeProject.processingStatus || []);
      setActiveStatusTab(0);
    } else {
      setProcessingStatus([]);
    }
  }, [activeProjectId]);

  // Save processingStatus to active project when it changes
  useEffect(() => {
    if (activeProject && processingStatus.length > 0) {
      // Only update if it's actually different to avoid loops
      const currentStatusStr = JSON.stringify(activeProject.processingStatus || []);
      const newStatusStr = JSON.stringify(processingStatus);
      if (currentStatusStr !== newStatusStr) {
        updateProject(activeProject.id, { processingStatus });
      }
    }
  }, [processingStatus]);

  // Persistence
  useEffect(() => {
    const loadProjects = async () => {
      const saved = localStorage.getItem('archival_projects');
      if (saved) {
        try {
          const parsedProjects: Project[] = JSON.parse(saved);
          // Load results from IndexedDB for each project
          const projectsWithResults = await Promise.all(parsedProjects.map(async p => {
            const storedResults = await pdfStorage.getResults(p.id);
            const { project } = normalizeProject(p, storedResults || []);
            return project;
          }));
          setProjects(projectsWithResults);
        } catch (e) {
          console.error("Failed to load projects", e);
        }
      }
    };
    loadProjects();
  }, []);

  useEffect(() => {
    if (projects.length > 0) {
      try {
        // Strip results before saving to localStorage
        const projectsToSave = projects.map(({ results, ...p }) => p);
        localStorage.setItem('archival_projects', JSON.stringify(projectsToSave));
        
        // Save results to IndexedDB
        projects.forEach(p => {
          if (p.results && p.results.length > 0) {
            pdfStorage.saveResults(p.id, p.results);
          }
        });
      } catch (e) {
        console.error("Failed to save projects to localStorage", e);
        if (e instanceof Error && e.name === 'QuotaExceededError') {
          addLog("Помилка: Недостатньо місця в localStorage. Проте дані результатів збережені в IndexedDB.", 'warn');
        }
      }
    }
  }, [projects]);

  const saveGeminiKey = (key: string) => {
    setGeminiKey(key);
    localStorage.setItem('gemini_key', key);
  };

  const saveGeminiModel = (model: string) => {
    setGeminiModel(model);
    localStorage.setItem('gemini_model', model);
  };

  const handleGoogleConnect = async () => {
    if (!activeProject) return;
    setGoogleAuthLoading(true);
    try {
      const redirectUri = `${window.location.origin}/api/auth/google/callback`;
      const response = await fetch(`/api/auth/google/url?redirectUri=${encodeURIComponent(redirectUri)}`);
      
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Сервер повернув помилку ${response.status}. Можливо, бекенд не працює (наприклад, на Vercel без налаштування API).`);
      }
      
      const { url } = await response.json();
      
      const authWindow = window.open(url, 'google_auth', 'width=600,height=700');
      
      const handleMessage = async (event: MessageEvent) => {
        if (event.data?.type === 'GOOGLE_AUTH_SUCCESS') {
          const tokens = event.data.tokens;
          updateProject(activeProject.id, { googleSheetsTokens: tokens });
          addLog("Google Sheets підключено успішно");
          window.removeEventListener('message', handleMessage);
        }
      };
      window.addEventListener('message', handleMessage);
    } catch (err) {
      addLog(`Помилка підключення Google: ${err}`, 'error');
    } finally {
      setGoogleAuthLoading(false);
    }
  };

  // Helper to parse page range
  const parsePageRange = (rangeStr: string, maxPages: number): number[] => {
    if (!rangeStr || rangeStr.trim() === "") {
      return Array.from({ length: maxPages }, (_, i) => i + 1);
    }
    const pages = new Set<number>();
    const parts = rangeStr.split(',').map(p => p.trim());
    for (const part of parts) {
      if (part.includes('-')) {
        const [start, end] = part.split('-').map(Number);
        if (!isNaN(start) && !isNaN(end)) {
          for (let i = Math.max(1, start); i <= Math.min(maxPages, end); i++) {
            pages.add(i);
          }
        }
      } else {
        const p = Number(part);
        if (!isNaN(p) && p >= 1 && p <= maxPages) {
          pages.add(p);
        }
      }
    }
    return Array.from(pages).sort((a, b) => a - b);
  };

  const createProject = () => {
    const { project: newProject } = normalizeProject({
      id: crypto.randomUUID(),
      name: `Новий проект ${projects.length + 1}`,
      pdfUrls: [],
      keywords: [],
      tableStructure: createDefaultColumns(),
      scenario: 'search',
      results: [],
      createdAt: Date.now()
    });
    setProjects([...projects, newProject]);
    setActiveProjectId(newProject.id);
  };

  const deleteProject = (id: string) => {
    setProjects(prev => prev.filter(p => p.id !== id));
    pdfStorage.deleteResults(id); // Clean up IndexedDB
    if (activeProjectId === id) setActiveProjectId(null);
  };

  const updateProject = (id: string, updates: Partial<Project>) => {
    setProjects(prev => prev.map(p => {
      if (p.id !== id) return p;

      const nextProject = { ...p, ...updates };
      if (!updates.tableStructure) {
        return nextProject;
      }

      return normalizeProject(nextProject, nextProject.results).project;
    }));
  };

  const exportProject = (project: Project) => {
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.name}.json`;
    a.click();
  };

  const importProject = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const imported = JSON.parse(e.target?.result as string);
        const { project } = normalizeProject({ ...imported, id: crypto.randomUUID() });
        setProjects([...projects, project]);
      } catch (err) {
        setError("Помилка імпорту файлу");
      }
    };
    reader.readAsText(file);
  };

  const exportToCSV = (project: Project) => {
    const headers = getExportHeaders(project.tableStructure);
    const csvData = project.results.map(r => {
      const row = project.tableStructure.reduce<Record<string, string | number>>((acc, col, index) => {
        acc[getColumnLabel(col, index)] = getColumnValue(r.data, col);
        return acc;
      }, {});

      row['Посилання на файл'] = r.pdfUrl;
      row['Сторінка'] = r.pageNumber;
      row['Теги'] = r.tags?.join(', ') || '';

      return row;
    });

    const csv = Papa.unparse({
      fields: headers,
      data: csvData
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.name}_results.csv`;
    a.click();
  };

  const updateStatus = (url: string, updates: Partial<ProcessingStatus>) => {
    setProcessingStatus(prev => prev.map(s => s.pdfUrl === url ? { ...s, ...updates } : s));
  };

  const updatePageStatus = (url: string, pageNum: number, updates: Partial<PageStatus>) => {
    setProcessingStatus(prev => prev.map(s => {
      if (s.pdfUrl !== url) return s;
      const pages = s.pages || [];
      const pageIdx = pages.findIndex(p => p.pageNumber === pageNum);
      if (pageIdx === -1) {
        return { ...s, pages: [...pages, { pageNumber: pageNum, status: 'pending', progress: 0, ...updates }] };
      }
      const newPages = [...pages];
      newPages[pageIdx] = { ...newPages[pageIdx], ...updates };
      return { ...s, pages: newPages };
    }));
  };

  const processSinglePage = async (
    pdf: pdfjs.PDFDocumentProxy, 
    pageNum: number, 
    url: string, 
    project: Project, 
    gemini: GeminiService
  ): Promise<ArchivalRecord[]> => {
    const pageStartedAt = performance.now();
    updatePageStatus(url, pageNum, { status: 'processing', progress: 10 });

    addLog(`Сторінка ${pageNum} (${url}): початок підготовки PDF-сторінки...`);
    const pdfPageStartedAt = performance.now();
    const page = await pdf.getPage(pageNum);
    logDuration(`Сторінка ${pageNum} (${url}): PDF-сторінку отримано`, pdfPageStartedAt, 5000);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.height = viewport.height;
    canvas.width = viewport.width;
    
    const renderStartedAt = performance.now();
    await page.render({ 
      canvasContext: context!, 
      viewport 
    } as any).promise;
    logDuration(`Сторінка ${pageNum} (${url}): canvas render завершено`, renderStartedAt, 10000);

    const imageEncodeStartedAt = performance.now();
    const imageBase64 = canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
    logDuration(`Сторінка ${pageNum} (${url}): JPEG/base64 підготовлено`, imageEncodeStartedAt, 7000);

    updatePageStatus(url, pageNum, { progress: 40 });
    addLog(`Сторінка ${pageNum} (${url}): початок Gemini-запиту...`);
    const geminiStartedAt = performance.now();
    const rawPageResults = await gemini.processPage(
      imageBase64,
      project.tableStructure
    );
    logDuration(`Сторінка ${pageNum} (${url}): Gemini-відповідь отримана`, geminiStartedAt, 30000);
    const pageResults = rawPageResults.map((result: any) => ({
      ...result,
      data: normalizeRecordData(result?.data, project.tableStructure),
      tags: Array.isArray(result?.tags)
        ? result.tags.map((tag: unknown) => toCellValue(tag)).filter(Boolean)
        : []
    }));
    
    const foundCount = pageResults.length;
    addLog(`Gemini AI знайшов ${foundCount} записів на сторінці ${pageNum} (${url})`);

    if (foundCount === 0) {
      updatePageStatus(url, pageNum, { status: 'completed', progress: 100 });
      return [];
    }

    updatePageStatus(url, pageNum, { progress: 70 });
    const fragmentsStartedAt = performance.now();
    const recordsWithFragments: ArchivalRecord[] = pageResults.map((res: any) => {
      const boundingBox = Array.isArray(res.boundingBox) && res.boundingBox.length === 4
        ? res.boundingBox
        : [0, 0, 1000, 1000];
      const [ymin, xmin, ymax, xmax] = boundingBox;
      const cropX = (xmin / 1000) * canvas.width;
      const cropY = (ymin / 1000) * canvas.height;
      const cropW = ((xmax - xmin) / 1000) * canvas.width;
      const cropH = ((ymax - ymin) / 1000) * canvas.height;

      const fragmentCanvas = document.createElement('canvas');
      fragmentCanvas.width = cropW;
      fragmentCanvas.height = cropH;
      const fCtx = fragmentCanvas.getContext('2d');
      fCtx?.drawImage(canvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

      return {
        id: crypto.randomUUID(),
        projectId: project.id,
        pdfUrl: url,
        pageNumber: pageNum,
        data: res.data,
        tags: res.tags,
        fragmentImage: fragmentCanvas.toDataURL('image/png')
      };
    });
    logDuration(`Сторінка ${pageNum} (${url}): вирізання фрагментів завершено`, fragmentsStartedAt, 10000);

    if (project.googleSheetsTokens && project.googleSheetsId) {
      const batchValues = pageResults.map((res: any) => {
        const row = project.tableStructure.map(col => getColumnValue(res.data, col));
        row.push(url);
        row.push(pageNum.toString());
        row.push(res.tags ? res.tags.join(", ") : "");
        return row;
      });

      addLog(`Сторінка ${pageNum} (${url}): запис ${batchValues.length} рядків у Google Sheets...`);
      const sheetsStartedAt = performance.now();
      const response = await fetch('/api/sheets/append', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tokens: project.googleSheetsTokens,
          spreadsheetId: project.googleSheetsId,
          sheetName: project.googleSheetsSheetName,
          headers: getExportHeaders(project.tableStructure),
          values: batchValues
        })
      });
      
      if (!response.ok) {
        let errMessage = 'Помилка запису в таблицю';
        try {
          const errData = await response.json();
          errMessage = errData.error || errMessage;
        } catch (e) {
          errMessage = `Сервер повернув помилку ${response.status}. Можливо, бекенд не працює.`;
        }
        throw new Error(errMessage);
      }

      logDuration(`Сторінка ${pageNum} (${url}): запис у Google Sheets завершено`, sheetsStartedAt, 15000);
    }

    updatePageStatus(url, pageNum, { status: 'completed', progress: 100 });
    logDuration(`Сторінка ${pageNum} (${url}): повна обробка сторінки завершена`, pageStartedAt, 45000);
    return recordsWithFragments;
  };

  const getFileBuffer = async (
    file: { url: string; isLocal: boolean; id?: string },
    contextLabel?: string
  ) => {
    const label = contextLabel || file.url;
    const bufferStartedAt = performance.now();
    addLog(`${label}: початок читання ${file.isLocal ? 'локального' : 'віддаленого'} PDF...`);

    if (file.isLocal && file.id) {
      const localFileRef = activeProject?.files?.find(f => f.id === file.id) || 
                         activeProject?.localPdfs?.find(f => f.id === file.id);
      
      if (localFileRef?.handle) {
        const fileData = await localFileRef.handle.getFile();
        const arrayBuffer = await fileData.arrayBuffer();
        logDuration(`${label}: локальний PDF прочитано (${formatBytes(arrayBuffer.byteLength)})`, bufferStartedAt, 5000);
        return arrayBuffer;
      } else {
        const storedData = await pdfStorage.get(file.id);
        if (!storedData) throw new Error("Локальний файл не знайдено");
        logDuration(`${label}: PDF отримано з IndexedDB (${formatBytes(storedData.byteLength)})`, bufferStartedAt, 5000);
        return storedData;
      }
    } else {
      const response = await fetch(`/api/proxy-pdf?url=${encodeURIComponent(file.url)}`);
      if (!response.ok) throw new Error(`Не вдалося завантажити PDF: ${response.statusText}`);
      const arrayBuffer = await response.arrayBuffer();
      logDuration(`${label}: віддалений PDF завантажено (${formatBytes(arrayBuffer.byteLength)})`, bufferStartedAt, 10000);
      return arrayBuffer;
    }
  };

  const retryPage = async (url: string, pageNum: number) => {
    if (!activeProject || !geminiKey) return;
    
    addLog(`Перезапуск опрацювання сторінки ${pageNum} для ${url} [Модель: ${geminiModelRef.current}]...`);
    const gemini = new GeminiService(geminiKeyRef.current, geminiModelRef.current);
    
    try {
      // 1. Find file info
      const file = [...(activeProject.files || []), ...(activeProject.localPdfs || []).map(f => ({ ...f, isLocal: true, url: f.name }))]
        .find(f => (f as any).url === url || f.name === url);
      
      if (!file) throw new Error("Файл не знайдено");

      // 2. Load PDF
      const arrayBuffer = await getFileBuffer(file as any, `Повтор сторінки ${pageNum} (${url})`);
      addLog(`Повтор сторінки ${pageNum} (${url}): відкриття PDF у pdf.js...`);
      const retryPdfStartedAt = performance.now();
      const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
      logDuration(`Повтор сторінки ${pageNum} (${url}): PDF відкрито в pdf.js`, retryPdfStartedAt, 10000);

      // 3. Delete old data from Google Sheets if connected
      if (activeProject.googleSheetsTokens && activeProject.googleSheetsId) {
        addLog(`Видалення старих даних сторінки ${pageNum} з Google Sheets...`);
        await fetch('/api/sheets/delete-rows', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tokens: activeProject.googleSheetsTokens,
            spreadsheetId: activeProject.googleSheetsId,
            sheetName: activeProject.googleSheetsSheetName,
            pdfUrl: url,
            pageNumber: pageNum
          })
        });
      }

      // 4. Process page
      const newResults = await processSinglePage(pdf, pageNum, url, activeProject, gemini);

      // 5. Update local results
      const filteredResults = activeProject.results.filter(r => !(r.pdfUrl === url && r.pageNumber === pageNum));
      updateProject(activeProject.id, { results: [...filteredResults, ...newResults] });
      
      addLog(`Сторінку ${pageNum} успішно переопрацьовано.`);
    } catch (err) {
      let msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('429') || msg.toLowerCase().includes('quota') || msg.toLowerCase().includes('rate limit')) {
        msg = `Перевищено ліміт запитів Gemini (${geminiModelRef.current}). Спробуйте іншу модель або зачекайте кілька хвилин.`;
      }
      addLog(`Помилка перезапуску сторінки ${pageNum}: ${msg}`, 'error');
      updatePageStatus(url, pageNum, { status: 'error', message: msg });
    }
  };

  const stopProcessing = () => {
    setIsStopping(true);
    stopRef.current = true;
    addLog("Запит на зупинку опрацювання...", 'warn');
  };

  // Processing Logic
  const startProcessing = async (mode: 'start' | 'continue' = 'continue') => {
    if (!activeProject || !geminiKey) {
      const msg = "Будь ласка, вкажіть Gemini API ключ у налаштуваннях";
      setError(msg);
      addLog(msg, 'error');
      return;
    }

    setIsProcessing(true);
    setIsStopping(false);
    stopRef.current = false;
    setError(null);
    addLog(`Запуск опрацювання проекту (${mode === 'start' ? 'спочатку' : 'продовження'}): ${activeProject.name} [Модель: ${geminiModelRef.current}]`);
    console.log(`Starting processing with model: ${geminiModelRef.current}`);

    if (mode === 'start') {
      await pdfStorage.saveResults(activeProject.id, []);
      updateProject(activeProject.id, { results: [], processingStatus: [] });
      setProcessingStatus([]);
      setActiveStatusTab(0);
    }

    // 1. Add Headers to Google Sheets first if connected
    if (activeProject.googleSheetsTokens && activeProject.googleSheetsId && mode === 'start') {
      try {
        addLog("Підготовка Google Sheets: запис заголовків...");
        const headers = getExportHeaders(activeProject.tableStructure);

        const response = await fetch('/api/sheets/append', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tokens: activeProject.googleSheetsTokens,
            spreadsheetId: activeProject.googleSheetsId,
            sheetName: activeProject.googleSheetsSheetName,
            values: headers,
            isHeader: true
          })
        });
        if (!response.ok) {
          throw new Error(`Сервер повернув помилку ${response.status}. Можливо, бекенд не працює.`);
        }
        addLog("Заголовки успішно додано та відформатовано в Google Sheets");
      } catch (err) {
        addLog(`Помилка підготовки заголовків: ${err}`, 'warn');
      }
    }
    
    // Prepare all files
    const allFiles: { url: string; isLocal: boolean; id?: string; pageRange?: string }[] = [];
    
    // Handle legacy pdfUrls
    activeProject.pdfUrls.forEach(url => {
      allFiles.push({ url, isLocal: false });
    });
    
    // Handle new files structure
    if (activeProject.files) {
      activeProject.files.forEach(f => {
        allFiles.push({ url: f.url || f.name, isLocal: f.isLocal, id: f.id, pageRange: f.pageRange });
      });
    }
    
    // Handle legacy localPdfs
    if (activeProject.localPdfs) {
      activeProject.localPdfs.forEach(f => {
        if (!allFiles.find(af => af.id === f.id)) {
          allFiles.push({ url: f.name, isLocal: true, id: f.id });
        }
      });
    }

    // Initialize or preserve statuses
    let currentStatuses = [...processingStatus];
    
    // Check if we need to initialize any new files
    const missingFiles = allFiles.filter(f => !currentStatuses.find(s => s.pdfUrl === f.url));
    
    if (mode === 'start' || (mode === 'continue' && missingFiles.length > 0)) {
      addLog(mode === 'start' ? "Попередній аналіз файлів..." : "Аналіз нових файлів...");
      const initialStatuses: ProcessingStatus[] = mode === 'start' ? [] : [...currentStatuses];
      const filesToProcess = mode === 'start' ? allFiles : missingFiles;

      for (const f of filesToProcess) {
        try {
          const buffer = await getFileBuffer(f, `Початковий аналіз ${f.url}`);
          addLog(`Початковий аналіз ${f.url}: відкриття PDF у pdf.js...`);
          const initPdfStartedAt = performance.now();
          const pdf = await pdfjs.getDocument({ data: buffer }).promise;
          logDuration(`Початковий аналіз ${f.url}: PDF відкрито в pdf.js`, initPdfStartedAt, 10000);
          const targetPages = parsePageRange(f.pageRange || "", pdf.numPages);
          
          const pages = targetPages.map(p => {
            const isDone = activeProject.results.some(r => r.pdfUrl === f.url && r.pageNumber === p);
            return { 
              pageNumber: p, 
              status: isDone ? 'completed' : 'pending' as any, 
              progress: isDone ? 100 : 0 
            };
          });

          const allDone = pages.every(p => p.status === 'completed');
          const completedCount = pages.filter(p => p.status === 'completed').length;

          initialStatuses.push({
            pdfUrl: f.url,
            status: allDone ? 'completed' : 'pending',
            progress: allDone ? 100 : (completedCount / pages.length) * 100,
            pages
          });
        } catch (err) {
          initialStatuses.push({
            pdfUrl: f.url,
            status: 'error',
            progress: 0,
            message: `Помилка завантаження: ${err}`,
            pages: []
          });
        }
      }
      currentStatuses = initialStatuses;
      setProcessingStatus(initialStatuses);
    }

    for (let i = 0; i < allFiles.length; i++) {
      if (stopRef.current) break;

      const file = allFiles[i];
      const url = file.url;
      
      const fileStatus = currentStatuses.find(s => s.pdfUrl === url);

      if (mode === 'continue' && fileStatus?.status === 'completed') {
        continue;
      }

      addLog(`Опрацювання файлу: ${url}`);
      const fileStartedAt = performance.now();
      updateStatus(url, { status: 'processing', progress: 10 });
      if (fileStatus) {
        fileStatus.status = 'processing';
        fileStatus.progress = 10;
      }

      try {
        const arrayBuffer = await getFileBuffer(file, `Опрацювання файлу ${url}`);
        if (stopRef.current) break;

        addLog(`Опрацювання файлу ${url}: відкриття PDF у pdf.js...`);
        const pdfOpenStartedAt = performance.now();
        const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
        logDuration(`Опрацювання файлу ${url}: PDF відкрито в pdf.js`, pdfOpenStartedAt, 10000);
        const numPages = pdf.numPages;
        const targetPages = parsePageRange(file.pageRange || "", numPages);
        
        // Ensure pages are initialized
        if (!fileStatus?.pages || fileStatus.pages.length === 0) {
          const pages = targetPages.map(p => ({ pageNumber: p, status: 'pending' as any, progress: 0 }));
          updateStatus(url, { pages });
          if (fileStatus) fileStatus.pages = pages;
        }

        let completedInFile = targetPages.filter(p => {
          const ps = fileStatus?.pages?.find(pg => pg.pageNumber === p);
          return ps?.status === 'completed';
        }).length;

        const currentGemini = new GeminiService(geminiKeyRef.current, geminiModelRef.current);
        for (const pageNum of targetPages) {
          if (stopRef.current) break;

          const pageStatus = fileStatus?.pages?.find(p => p.pageNumber === pageNum);
          if (mode === 'continue' && pageStatus?.status === 'completed') {
            continue;
          }

          let retryCount = 0;
          const maxRetries = 2;
          let success = false;

          while (retryCount <= maxRetries && !success) {
            if (stopRef.current) break;

            try {
              if (retryCount > 0) {
                addLog(`Повторна спроба для сторінки ${pageNum} через ліміти (спроба ${retryCount}/${maxRetries}). Очікуємо 15с...`, 'warn');
                updatePageStatus(url, pageNum, { status: 'processing', message: `Очікування лімітів (спроба ${retryCount})...` });
                const waitStartedAt = performance.now();
                addLog(`Сторінка ${pageNum} (${url}): пауза перед повтором 15с...`);
                await new Promise(resolve => setTimeout(resolve, 15000));
                const actualWait = performance.now() - waitStartedAt;
                addLog(
                  `Сторінка ${pageNum} (${url}): пауза завершена за ${formatDuration(actualWait)}`,
                  actualWait > 17000 ? 'warn' : 'info'
                );
              }
              const pageResults = await processSinglePage(pdf, pageNum, url, activeProject, currentGemini);
              
              if (pageResults.length > 0) {
                const saveResultsStartedAt = performance.now();
                const currentResults = await pdfStorage.getResults(activeProject.id) || [];
                const updatedResults = [...currentResults, ...pageResults];
                await pdfStorage.saveResults(activeProject.id, updatedResults);
                updateProject(activeProject.id, { results: updatedResults });
                logDuration(`Сторінка ${pageNum} (${url}): результати збережено локально`, saveResultsStartedAt, 5000);
              }
              
              if (pageStatus) {
                pageStatus.status = 'completed';
                pageStatus.progress = 100;
                pageStatus.message = undefined;
              }
              completedInFile++;
              success = true;
            } catch (err) {
              let msg = err instanceof Error ? err.message : String(err);
              const isRateLimit = msg.includes('429') || msg.toLowerCase().includes('quota') || msg.toLowerCase().includes('rate limit');
              
              if (isRateLimit && retryCount < maxRetries) {
                retryCount++;
                continue;
              }

              if (isRateLimit) {
                msg = `Перевищено ліміт запитів Gemini (${geminiModelRef.current}) після декількох спроб. Спробуйте іншу модель або зачекайте кілька хвилин.`;
              }
              
              addLog(`Помилка сторінки ${pageNum} [Модель: ${geminiModelRef.current}]: ${msg}`, 'error');
              updatePageStatus(url, pageNum, { status: 'error', message: msg });
              if (pageStatus) {
                pageStatus.status = 'error';
                pageStatus.message = msg;
              }
              break; // Exit retry loop on non-rate-limit error or max retries
            }
          }
          
          const fileProgress = 10 + (completedInFile / targetPages.length) * 90;
          updateStatus(url, { progress: fileProgress });
          if (fileStatus) fileStatus.progress = fileProgress;
        }

        if (!stopRef.current) {
          updateStatus(url, { status: 'completed', progress: 100 });
          if (fileStatus) {
            fileStatus.status = 'completed';
            fileStatus.progress = 100;
          }
        }
        // Save current statuses to project after each file
        updateProject(activeProject.id, { processingStatus: currentStatuses });
        logDuration(`Опрацювання файлу ${url}: файл завершено`, fileStartedAt, 60000);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        addLog(`Помилка опрацювання ${url}: ${errorMsg}`, 'error');
        updateStatus(url, { status: 'error', message: errorMsg });
        if (fileStatus) {
          fileStatus.status = 'error';
          fileStatus.message = errorMsg;
        }
      }
    }

    setIsProcessing(false);
    setIsStopping(false);
    if (stopRef.current) {
      addLog("Опрацювання зупинено користувачем.", 'warn');
    } else {
      addLog(`Опрацювання проекту ${activeProject.name} завершено.`);
    }
  };

  const startIndexing = async () => {
    if (!activeProject || !geminiKey) return;
    setIsIndexing(true);
    stopRef.current = false;
    addLog("Запуск створення покажчика (тегів)...");
    const gemini = new GeminiService(geminiKey, geminiModel);
    const titleColumn = getTitleColumn(activeProject.tableStructure);

    if (!titleColumn) {
      addLog('Для створення покажчика призначте одній з колонок роль "Назва справи".', 'warn');
      setIsIndexing(false);
      return;
    }
    
    const updatedResults = [...activeProject.results];
    let changed = false;

    for (let i = 0; i < updatedResults.length; i++) {
      if (stopRef.current) break;
      const record = updatedResults[i];
      if (record.tags && record.tags.length > 0) continue;

      try {
        const titleColumnIndex = titleColumn
          ? activeProject.tableStructure.findIndex(c => c.id === titleColumn.id)
          : -1;
        const tagsColumnIndex = activeProject.tableStructure.length + 2; // URL, Page, Tags

        const title = titleColumn ? getColumnValue(record.data, titleColumn) : "";
        if (!title) continue;

        const tags = await gemini.generateTags(title);
        if (tags.length > 0) {
          updatedResults[i] = { ...record, tags };
          changed = true;
          addLog(`Створено теги для: ${title.substring(0, 30)}...`);
          
          if (activeProject.googleSheetsTokens && activeProject.googleSheetsId) {
            const response = await fetch('/api/sheets/update-tags', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                tokens: activeProject.googleSheetsTokens,
                spreadsheetId: activeProject.googleSheetsId,
                sheetName: activeProject.googleSheetsSheetName,
                pdfUrl: record.pdfUrl,
                pageNumber: record.pageNumber,
                title: title,
                tags: tags,
                titleColumnIndex,
                tagsColumnIndex
              })
            });
            if (!response.ok) {
              const errData = await response.json().catch(() => ({}));
              throw new Error(errData.error || `Сервер повернув помилку ${response.status}`);
            }
          }
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (err) {
        addLog(`Помилка створення тегів: ${err}`, 'error');
      }
    }

    if (changed) {
      await pdfStorage.saveResults(activeProject.id, updatedResults);
      updateProject(activeProject.id, { results: updatedResults });
    }
    setIsIndexing(false);
    addLog("Створення покажчика завершено.");
  };

  const updateColumnRole = (project: Project, columnId: string, role: ColumnRole) => {
    const newCols = project.tableStructure.map(column => {
      if (role !== 'none' && column.role === role && column.id !== columnId) {
        return { ...column, role: 'none' as ColumnRole };
      }

      if (column.id === columnId) {
        return { ...column, role };
      }

      return column;
    });

    updateProject(project.id, { tableStructure: newCols });
  };

  const moveColumn = (project: Project, fromIndex: number, toIndex: number) => {
    if (toIndex < 0 || toIndex >= project.tableStructure.length) {
      return;
    }

    const newCols = [...project.tableStructure];
    const [movedColumn] = newCols.splice(fromIndex, 1);
    newCols.splice(toIndex, 0, movedColumn);
    updateProject(project.id, { tableStructure: newCols });
  };

  return (
    <div className="flex h-screen bg-[#F8F9FA] text-slate-900 font-sans">
      {/* Sidebar */}
      <aside className="w-72 bg-white border-r border-slate-200 flex flex-col">
        <div className="p-6 border-b border-slate-100">
          <div className="flex flex-col items-center gap-3 mb-8">
            <div className="w-20 h-20 overflow-hidden relative">
              <img 
                src="logo.png" 
                alt="Logo" 
                className="absolute inset-0 w-full h-full object-contain" 
              />
            </div>
            <h1 className="font-bold text-xl tracking-tight">Блукач Описами</h1>
          </div>
          
          <button 
            onClick={createProject}
            className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white py-2.5 rounded-lg font-medium transition-all shadow-sm"
          >
            <Plus size={18} />
            Новий проект
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto p-4 space-y-1">
          {projects.map(p => (
            <div 
              key={p.id}
              onClick={() => setActiveProjectId(p.id)}
              className={cn(
                "group flex items-center justify-between p-3 rounded-lg cursor-pointer transition-colors",
                activeProjectId === p.id ? "bg-indigo-50 text-indigo-700" : "hover:bg-slate-50 text-slate-600"
              )}
            >
              <div className="flex items-center gap-3 overflow-hidden">
                <FileText size={18} className={activeProjectId === p.id ? "text-indigo-600" : "text-slate-400"} />
                <span className="truncate font-medium">{p.name}</span>
              </div>
              <button 
                onClick={(e) => { e.stopPropagation(); deleteProject(p.id); }}
                className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-50 hover:text-red-600 rounded transition-all"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </nav>

        <div className="p-4 border-t border-slate-100 space-y-4">
          <div className="space-y-3">
            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 px-3">Gemini API Key</label>
              <div className="relative px-3">
                <input 
                  type="password"
                  value={geminiKey}
                  onChange={(e) => saveGeminiKey(e.target.value)}
                  placeholder="Введіть ключ..."
                  className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:ring-2 focus:ring-indigo-500 outline-none pr-8"
                />
                <div className="absolute right-5 top-1/2 -translate-y-1/2 text-slate-300">
                  <SettingsIcon size={14} />
                </div>
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 px-3">Модель Gemini</label>
              <div className="px-3">
                <select 
                  value={geminiModel}
                  onChange={(e) => saveGeminiModel(e.target.value)}
                  className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:ring-2 focus:ring-indigo-500 outline-none appearance-none cursor-pointer"
                >
                  <option value="gemini-3-flash-preview">Gemini 3 Flash (Швидка)</option>
                  <option value="gemini-3.1-pro-preview">Gemini 3.1 Pro (Потужна)</option>
                  <option value="gemini-flash-latest">Gemini Flash Latest</option>
                </select>
              </div>
            </div>
          </div>
          
          <div className="flex gap-2 px-3">
            <label className="flex-1 flex items-center justify-center gap-2 p-2.5 bg-slate-50 border border-slate-200 rounded-lg hover:bg-slate-100 cursor-pointer text-slate-600 transition-colors text-xs font-bold">
              <Upload size={14} className="text-slate-400" />
              Імпорт проєкту
              <input type="file" accept=".json" onChange={importProject} className="hidden" />
            </label>
            <button 
              onClick={() => activeProject && exportProject(activeProject)}
              disabled={!activeProject}
              className="flex-1 flex items-center justify-center gap-2 p-2.5 bg-slate-50 border border-slate-200 rounded-lg hover:bg-slate-100 text-slate-600 transition-colors text-xs font-bold disabled:opacity-50"
            >
              <FileJson size={14} className="text-slate-400" />
              Експорт проєкту
            </button>
          </div>

          <button 
            onClick={async () => {
              if (confirm("Ви впевнені, що хочете видалити ВСІ проекти та дані? Це неможливо скасувати.")) {
                localStorage.removeItem('archival_projects');
                await pdfStorage.clear();
                window.location.reload();
              }
            }}
            className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-red-50 text-red-500 transition-colors text-left"
          >
            <Trash2 size={18} className="text-red-400" />
            <span className="font-medium text-sm">Очистити все</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto bg-slate-50/50">
        <AnimatePresence mode="wait">
          {activeProject ? (
            <motion.div 
              key={activeProject.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="p-8 max-w-6xl mx-auto"
            >
              <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
                <div>
                  <input 
                    type="text" 
                    value={activeProject.name}
                    onChange={(e) => updateProject(activeProject.id, { name: e.target.value })}
                    className="text-3xl font-bold bg-transparent border-none focus:ring-0 p-0 mb-1 w-full"
                  />
                  <p className="text-slate-500 text-sm">Створено: {new Date(activeProject.createdAt).toLocaleDateString('uk-UA')}</p>
                </div>
                <div className="flex flex-wrap gap-3">
                  <button 
                    onClick={() => setIsSettingsOpen(!isSettingsOpen)}
                    className={cn(
                      "flex items-center gap-2 px-4 py-2 rounded-lg transition-colors text-sm font-medium shadow-sm border",
                      isSettingsOpen ? "bg-indigo-50 border-indigo-200 text-indigo-700" : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                    )}
                  >
                    <SettingsIcon size={16} />
                    Налаштування
                  </button>
                  <button 
                    onClick={() => exportToCSV(activeProject)}
                    className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors text-sm font-medium shadow-sm"
                  >
                    <FileSpreadsheet size={16} />
                    Експорт CSV
                  </button>
                  <button 
                    disabled={isProcessing || isIndexing}
                    onClick={() => startProcessing('continue')}
                    className="flex items-center gap-2 px-6 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white rounded-lg transition-colors text-sm font-bold shadow-md"
                  >
                    <Play size={16} />
                    Продовжити
                  </button>
                  
                  {processingStatus.length > 0 && processingStatus.every(s => s.status === 'completed') && (
                    <button 
                      disabled={isIndexing || isProcessing}
                      onClick={startIndexing}
                      className="flex items-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-600 disabled:bg-amber-300 text-white rounded-lg transition-colors text-sm font-bold shadow-md"
                    >
                      {isIndexing ? <Loader2 size={16} className="animate-spin" /> : <Tag size={16} />}
                      Створити покажчик
                    </button>
                  )}
                  <button 
                    disabled={isProcessing}
                    onClick={() => startProcessing('start')}
                    className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors text-sm font-medium shadow-sm"
                  >
                    <RotateCcw size={16} />
                    Спочатку
                  </button>
                  {isProcessing && (
                    <button 
                      onClick={stopProcessing}
                      disabled={isStopping}
                      className="flex items-center gap-2 px-4 py-2 bg-red-50 border border-red-200 text-red-600 rounded-lg hover:bg-red-100 transition-colors text-sm font-bold shadow-sm"
                    >
                      {isStopping ? <Loader2 size={16} className="animate-spin" /> : <Square size={16} fill="currentColor" />}
                      Зупинити
                    </button>
                  )}
                  <button 
                    onClick={() => setShowLogs(!showLogs)}
                    className={cn(
                      "p-2 rounded-lg border transition-colors",
                      showLogs ? "bg-slate-800 text-white border-slate-800" : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                    )}
                    title="Логи"
                  >
                    <Terminal size={20} />
                  </button>
                </div>
              </header>

              <AnimatePresence>
                {isSettingsOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="mb-8 overflow-hidden"
                  >
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                      <div className="space-y-4">
                        <h4 className="font-bold text-sm flex items-center gap-2 text-slate-700">
                          <Database size={16} className="text-indigo-600" />
                          Структура таблиці
                        </h4>
                        <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                          {activeProject.tableStructure.map((col, idx) => (
                            <div key={col.id} className="flex items-center gap-2">
                              <div className="flex flex-col gap-1">
                                <button
                                  onClick={() => moveColumn(activeProject, idx, idx - 1)}
                                  disabled={idx === 0}
                                  className="text-slate-400 hover:text-indigo-600 disabled:text-slate-200 disabled:cursor-not-allowed transition-colors"
                                  title="Перемістити вгору"
                                >
                                  <ArrowUp size={12} />
                                </button>
                                <button
                                  onClick={() => moveColumn(activeProject, idx, idx + 1)}
                                  disabled={idx === activeProject.tableStructure.length - 1}
                                  className="text-slate-400 hover:text-indigo-600 disabled:text-slate-200 disabled:cursor-not-allowed transition-colors"
                                  title="Перемістити вниз"
                                >
                                  <ArrowDown size={12} />
                                </button>
                              </div>
                              <div className="flex-1 grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_160px] gap-2">
                                <input 
                                  value={col.label}
                                  onChange={(e) => {
                                    const newCols = [...activeProject.tableStructure];
                                    newCols[idx].label = e.target.value;
                                    updateProject(activeProject.id, { tableStructure: newCols });
                                  }}
                                  placeholder={getColumnLabel(col, idx)}
                                  className="w-full p-1.5 bg-slate-50 border border-slate-100 rounded text-xs"
                                />
                                <select
                                  value={col.role || 'none'}
                                  onChange={(e) => updateColumnRole(activeProject, col.id, e.target.value as ColumnRole)}
                                  className="w-full p-1.5 bg-slate-50 border border-slate-100 rounded text-xs text-slate-600"
                                >
                                  {COLUMN_ROLE_OPTIONS.map(role => (
                                    <option key={role} value={role}>
                                      {COLUMN_ROLE_LABELS[role]}
                                    </option>
                                  ))}
                                </select>
                              </div>
                              <button 
                                onClick={() => updateProject(activeProject.id, { tableStructure: activeProject.tableStructure.filter((_, i) => i !== idx) })}
                                className="text-slate-400 hover:text-red-500"
                              >
                                <Trash2 size={12} />
                              </button>
                            </div>
                          ))}
                        </div>
                        <button 
                          onClick={() => updateProject(activeProject.id, { tableStructure: [...activeProject.tableStructure, createColumn()] })}
                          className="w-full py-1.5 border border-dashed border-slate-200 rounded text-[10px] font-bold text-slate-400 hover:text-indigo-600 hover:border-indigo-200 transition-all"
                        >
                          + Додати колонку
                        </button>
                      </div>

                      <div className="space-y-4">
                        <h4 className="font-bold text-sm flex items-center gap-2 text-slate-700">
                          <FileSpreadsheet size={16} className="text-green-600" />
                          Google Sheets
                        </h4>
                        {!activeProject.googleSheetsTokens ? (
                          <button 
                            onClick={handleGoogleConnect}
                            disabled={googleAuthLoading}
                            className="w-full flex items-center justify-center gap-2 py-2 bg-green-600 text-white rounded-lg text-xs font-bold hover:bg-green-700 transition-colors disabled:bg-green-400"
                          >
                            {googleAuthLoading ? <Loader2 size={14} className="animate-spin" /> : <Database size={14} />}
                            Підключити
                          </button>
                        ) : (
                          <div className="space-y-2">
                            <div className="flex items-center justify-between p-2 bg-green-50 rounded-lg border border-green-100">
                              <span className="text-[10px] text-green-700 font-bold flex items-center gap-1 uppercase">
                                <CheckCircle2 size={12} />
                                Підключено
                              </span>
                              <button 
                                onClick={() => updateProject(activeProject.id, { googleSheetsTokens: undefined })}
                                className="text-[10px] text-green-600 hover:underline font-bold"
                              >
                                Відключити
                              </button>
                            </div>
                            <input 
                              value={activeProject.googleSheetsId || ''}
                              onChange={(e) => updateProject(activeProject.id, { googleSheetsId: e.target.value })}
                              placeholder="Spreadsheet ID..."
                              className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-xs outline-none focus:ring-2 focus:ring-green-500"
                            />
                            <input 
                              value={activeProject.googleSheetsSheetName || ''}
                              onChange={(e) => updateProject(activeProject.id, { googleSheetsSheetName: e.target.value })}
                              placeholder="Назва вкладки..."
                              className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-xs outline-none focus:ring-2 focus:ring-green-500"
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="space-y-8">
                {/* PDF Section */}
                <section className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                  <h3 className="font-bold mb-4 flex items-center gap-2">
                    <FileText size={18} className="text-indigo-600" />
                    PDF Документи
                  </h3>
                  <div className="grid grid-cols-1 gap-4">
                    <div className="space-y-3">
                      {/* Unified Files List */}
                      {(() => {
                        const files = activeProject.files || [];
                        const legacyLocal = (activeProject.localPdfs || []).filter(lf => !files.find(f => f.id === lf.id));
                        const legacyRemote = activeProject.pdfUrls.filter(url => !files.find(f => f.url === url));
                        
                        return [
                          ...files.map(f => ({ ...f, type: f.isLocal ? 'local' : 'remote' })),
                          ...legacyLocal.map(f => ({ id: f.id, name: f.name, isLocal: true, type: 'local' })),
                          ...legacyRemote.map(url => ({ id: url, name: url, url, isLocal: false, type: 'remote' }))
                        ].map((file, idx) => (
                          <div key={file.id || idx} className="flex flex-col gap-2 p-3 bg-slate-50 rounded-xl border border-slate-100">
                            <div className="flex items-center gap-3">
                              <div className={cn(
                                "w-8 h-8 rounded-lg flex items-center justify-center border",
                                file.isLocal ? "bg-indigo-50 text-indigo-400 border-indigo-100" : "bg-white text-slate-400 border-slate-100"
                              )}>
                                {file.isLocal ? <FileUp size={14} /> : <Search size={14} />}
                              </div>
                              <span className="flex-1 truncate text-sm text-slate-700 font-medium">{file.name}</span>
                              {file.isLocal && (
                                <label className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors cursor-pointer" title="Перезавантажити файл (якщо загубився)">
                                  <RotateCcw size={16} />
                                  <input 
                                    type="file" 
                                    accept=".pdf" 
                                    className="hidden" 
                                    onChange={async (e) => {
                                      const newFile = e.target.files?.[0];
                                      if (!newFile || !activeProject) return;
                                      try {
                                        const buffer = await newFile.arrayBuffer();
                                        await pdfStorage.save(file.id, buffer);
                                        addLog(`Файл ${file.name} успішно оновлено в сховищі.`);
                                      } catch (err) {
                                        addLog(`Помилка оновлення файлу: ${err}`, 'error');
                                      }
                                    }}
                                  />
                                </label>
                              )}
                              <button 
                                onClick={async () => {
                                  if (file.isLocal && file.id) {
                                    await pdfStorage.delete(file.id);
                                  }
                                  if (activeProject.files) {
                                    updateProject(activeProject.id, { files: activeProject.files.filter(f => f.id !== file.id) });
                                  } else {
                                    // Handle legacy cleanup
                                    if (file.isLocal) {
                                      updateProject(activeProject.id, { localPdfs: activeProject.localPdfs?.filter(f => f.id !== file.id) });
                                    } else {
                                      updateProject(activeProject.id, { pdfUrls: activeProject.pdfUrls.filter(url => url !== file.url) });
                                    }
                                  }
                                }}
                                className="text-slate-400 hover:text-red-500"
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>
                            <div className="flex items-center gap-2 pl-11">
                              <label className="text-[10px] font-bold text-slate-400 uppercase">Сторінки:</label>
                              <input 
                                value={(file as any).pageRange || ''}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  if (activeProject.files) {
                                    updateProject(activeProject.id, {
                                      files: activeProject.files.map(f => f.id === file.id ? { ...f, pageRange: val } : f)
                                    });
                                  } else {
                                    // Convert to new structure on first edit
                                    const newFiles = [
                                      ...(activeProject.files || []),
                                      ...legacyLocal.map(f => ({ id: f.id, name: f.name, isLocal: true })),
                                      ...legacyRemote.map(url => ({ id: url, name: url, url, isLocal: false }))
                                    ].map(f => f.id === file.id ? { ...f, pageRange: val } : f);
                                    updateProject(activeProject.id, { files: newFiles as any, pdfUrls: [], localPdfs: [] });
                                  }
                                }}
                                placeholder="Напр: 1-5 (за замовч. всі)"
                                className="flex-1 bg-white border border-slate-200 rounded px-2 py-1 text-[10px] outline-none focus:ring-1 focus:ring-indigo-500"
                              />
                            </div>
                          </div>
                        ));
                      })()}
                    </div>

                    <div className="flex flex-col gap-3 mt-2">
                      <label className="w-full flex items-center justify-center gap-2 py-2.5 border-2 border-dashed border-slate-200 rounded-xl text-sm font-bold text-slate-400 hover:text-indigo-600 hover:border-indigo-200 hover:bg-indigo-50/30 transition-all cursor-pointer">
                        <FileUp size={18} />
                        Вибрати PDF з диска
                        <input 
                          type="file" 
                          accept=".pdf" 
                          className="hidden" 
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (!file || !activeProject) return;
                            try {
                              const fileId = crypto.randomUUID();
                              const buffer = await file.arrayBuffer();
                              await pdfStorage.save(fileId, buffer);
                              const newFile = { id: fileId, name: file.name, isLocal: true };
                              updateProject(activeProject.id, { 
                                files: [...(activeProject.files || []), newFile] 
                              });
                              addLog(`Вибрано локальний файл: ${file.name}`);
                            } catch (err) {
                              addLog(`Помилка завантаження файлу: ${err}`, 'error');
                            }
                          }}
                        />
                      </label>
                    </div>
                  </div>
                </section>

                {(isProcessing || processingStatus.some(s => s.status !== 'pending')) && (
                  <section className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                    <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
                      <h3 className="font-bold flex items-center gap-2">
                        {isProcessing ? <Loader2 size={18} className="text-indigo-600 animate-spin" /> : <CheckCircle2 size={18} className="text-green-600" />}
                        Статус опрацювання
                      </h3>
                      {(() => {
                        const totalPages = processingStatus.reduce((acc, s) => acc + (s.pages?.length || 0), 0);
                        const completedPages = processingStatus.reduce((acc, s) => acc + (s.pages?.filter(p => p.status === 'completed').length || 0), 0);
                        const overallProgress = totalPages > 0 ? (completedPages / totalPages) * 100 : 0;
                        return (
                          <div className="flex items-center gap-4 w-full md:w-auto">
                            <div className="flex flex-col items-end">
                              <span className="text-xs font-bold text-slate-700">Загальний прогрес</span>
                              <span className="text-[10px] text-slate-400 font-bold">{completedPages} / {totalPages} сторінок</span>
                            </div>
                            <div className="flex-1 md:w-32 h-2 bg-slate-100 rounded-full overflow-hidden border border-slate-200">
                              <motion.div 
                                initial={{ width: 0 }}
                                animate={{ width: `${overallProgress}%` }}
                                className="h-full bg-indigo-600"
                              />
                            </div>
                            <span className="text-xs font-bold text-indigo-600 w-8">{Math.round(overallProgress)}%</span>
                          </div>
                        );
                      })()}
                    </div>

                    {/* Tabs */}
                    {processingStatus.length > 1 && (
                      <div className="flex border-b border-slate-100 mb-6 overflow-x-auto no-scrollbar">
                        {processingStatus.map((s, idx) => {
                          const fileName = s.pdfUrl.split('/').pop() || s.pdfUrl;
                          const isError = s.status === 'error';
                          const isCompleted = s.status === 'completed';
                          return (
                            <button
                              key={idx}
                              onClick={() => setActiveStatusTab(idx)}
                              className={cn(
                                "px-4 py-2 text-xs font-bold transition-all border-b-2 whitespace-nowrap flex items-center gap-2",
                                activeStatusTab === idx 
                                  ? "border-indigo-600 text-indigo-600 bg-indigo-50/30" 
                                  : "border-transparent text-slate-400 hover:text-slate-600 hover:bg-slate-50"
                              )}
                            >
                              {isError && <AlertCircle size={12} className="text-red-500" />}
                              {isCompleted && <CheckCircle2 size={12} className="text-green-500" />}
                              {!isError && !isCompleted && s.status !== 'pending' && <Loader2 size={12} className="animate-spin text-indigo-500" />}
                              <span className="max-w-[150px] truncate">{fileName}</span>
                              <span className="ml-1 px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded text-[9px]">
                                {Math.round(s.progress)}%
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}

                    <div className="space-y-6">
                      {processingStatus.map((s, idx) => {
                        if (processingStatus.length > 1 && activeStatusTab !== idx) return null;
                        
                        return (
                          <motion.div 
                            key={idx} 
                            initial={{ opacity: 0, x: 10 }}
                            animate={{ opacity: 1, x: 0 }}
                            className="space-y-3 p-4 bg-slate-50 rounded-xl border border-slate-100"
                          >
                            <div className="flex justify-between items-center">
                              <div className="flex flex-col">
                                <span className="text-xs font-bold text-slate-700 truncate max-w-[300px] md:max-w-full">{s.pdfUrl}</span>
                                <span className="text-[10px] text-slate-400 uppercase font-bold">
                                  {s.status === 'pending' && 'Очікування...'}
                                  {s.status === 'downloading' && 'Завантаження...'}
                                  {s.status === 'processing' && 'Аналіз...'}
                                  {s.status === 'completed' && 'Завершено'}
                                  {s.status === 'error' && s.message}
                                </span>
                              </div>
                              <span className="text-xs font-bold text-indigo-600">{Math.round(s.progress)}%</span>
                            </div>
                            
                            <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden">
                              <motion.div 
                                initial={{ width: 0 }}
                                animate={{ width: `${s.progress}%` }}
                                className={cn(
                                  "h-full transition-all",
                                  s.status === 'error' ? "bg-red-500" : "bg-indigo-600"
                                )}
                              />
                            </div>

                            {/* Pages List */}
                            {s.pages && s.pages.length > 0 && (
                              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2 pt-2">
                                {s.pages.map(page => (
                                  <div 
                                    key={page.pageNumber} 
                                    className={cn(
                                      "p-2 rounded-lg border text-[10px] flex flex-col gap-1 relative group",
                                      page.status === 'completed' ? "bg-green-50 border-green-100 text-green-700" :
                                      page.status === 'error' ? "bg-red-50 border-red-100 text-red-700" :
                                      page.status === 'processing' ? "bg-indigo-50 border-indigo-100 text-indigo-700" :
                                      "bg-white border-slate-100 text-slate-400"
                                    )}
                                  >
                                    <div className="flex justify-between items-center">
                                      <span className="font-bold">Стор. {page.pageNumber}</span>
                                      {page.status === 'processing' && <Loader2 size={10} className="animate-spin" />}
                                      {page.status === 'completed' && <CheckCircle2 size={10} />}
                                      {page.status === 'error' && <AlertCircle size={10} />}
                                    </div>
                                    <div className="h-1 bg-current opacity-20 rounded-full overflow-hidden">
                                      <div className="h-full bg-current" style={{ width: `${page.progress}%` }} />
                                    </div>
                                    
                                    {/* Retry Button Overlay */}
                                    {page.status === 'error' && (
                                      <button 
                                        onClick={() => retryPage(s.pdfUrl, page.pageNumber)}
                                        className="absolute inset-0 bg-red-600 text-white opacity-0 group-hover:opacity-100 transition-opacity rounded-lg flex items-center justify-center gap-1 font-bold"
                                      >
                                        <Play size={10} />
                                        Повтор
                                      </button>
                                    )}
                                    {page.status === 'completed' && (
                                      <button 
                                        onClick={() => retryPage(s.pdfUrl, page.pageNumber)}
                                        className="absolute inset-0 bg-indigo-600 text-white opacity-0 group-hover:opacity-100 transition-opacity rounded-lg flex items-center justify-center gap-1 font-bold"
                                      >
                                        <Play size={10} />
                                        Оновити
                                      </button>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </motion.div>
                        );
                      })}
                    </div>
                  </section>
                )}

                {activeProject.results.length > 0 && (
                  <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden w-full">
                    <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                      <h3 className="font-bold flex items-center gap-2">
                        <Database size={18} className="text-indigo-600" />
                        Результати ({activeProject.results.length})
                      </h3>
                      <div className="flex gap-4">
                        <button 
                          onClick={() => exportToCSV(activeProject)}
                          className="text-xs font-bold text-indigo-600 hover:text-indigo-700 flex items-center gap-1"
                        >
                          <FileSpreadsheet size={12} />
                          CSV
                        </button>
                        <button 
                          onClick={() => updateProject(activeProject.id, { results: [] })}
                          className="text-xs font-bold text-red-500 hover:text-red-600 flex items-center gap-1"
                        >
                          <Trash2 size={12} />
                          Очистити
                        </button>
                      </div>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm text-left border-collapse">
                        <thead className="bg-slate-50 text-slate-500 font-bold uppercase tracking-wider text-[10px] border-b border-slate-100">
                          <tr>
                            <th className="px-6 py-4">Фрагмент</th>
                            {activeProject.tableStructure.map((col, index) => (
                              <th key={col.id} className="px-6 py-4">{getColumnLabel(col, index)}</th>
                            ))}
                            <th className="px-6 py-4">Джерело</th>
                            <th className="px-6 py-4">Теги</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {activeProject.results.map((res) => (
                            <tr key={res.id} className="hover:bg-slate-50/50 transition-colors">
                              <td className="px-6 py-4">
                                {res.fragmentImage && (
                                  <div 
                                    className="relative group cursor-zoom-in"
                                    onClick={() => setSelectedImage(res.fragmentImage)}
                                  >
                                    <img 
                                      src={res.fragmentImage} 
                                      alt="Fragment" 
                                      className="max-h-24 rounded border border-slate-200 shadow-sm group-hover:border-indigo-300 transition-all"
                                      referrerPolicy="no-referrer"
                                    />
                                    <div className="absolute inset-0 bg-indigo-600/0 group-hover:bg-indigo-600/10 rounded transition-all flex items-center justify-center">
                                      <Search size={16} className="text-white opacity-0 group-hover:opacity-100" />
                                    </div>
                                  </div>
                                )}
                              </td>
                              {activeProject.tableStructure.map(col => (
                                <td key={col.id} className="px-6 py-4 font-medium text-slate-700">
                                  {getColumnValue(res.data, col) || '-'}
                                </td>
                              ))}
                              <td className="px-6 py-4">
                                <div className="text-[10px] text-slate-400 font-bold uppercase">
                                  Стор. {res.pageNumber}
                                </div>
                                <div className="text-[10px] text-slate-400 truncate max-w-[150px]">
                                  {res.pdfUrl}
                                </div>
                              </td>
                              <td className="px-6 py-4">
                                <div className="flex flex-wrap gap-1">
                                  {res.tags?.map(tag => (
                                    <span key={tag} className="bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded text-[10px] font-medium border border-amber-100">
                                      {tag}
                                    </span>
                                  ))}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                )}
              </div>
            </motion.div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-slate-400 p-8 text-center">
              <div className="w-20 h-20 bg-slate-100 rounded-3xl flex items-center justify-center mb-6">
                <FolderPlus size={40} />
              </div>
              <h2 className="text-2xl font-bold text-slate-600 mb-2">Вітаємо в Описовому Блукачі</h2>
              <p className="max-w-md mb-8">Створіть новий проект або імпортуйте існуючий, щоб розпочати опрацювання архівних описів.</p>
              <button 
                onClick={createProject}
                className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-8 py-3 rounded-xl font-bold transition-all shadow-lg"
              >
                <Plus size={20} />
                Створити перший проект
              </button>
            </div>
          )}
        </AnimatePresence>

        {selectedImage && (
          <div 
            className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm z-50 flex items-center justify-center p-8 cursor-zoom-out"
            onClick={() => setSelectedImage(null)}
          >
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="relative max-w-5xl max-h-full bg-white p-2 rounded-2xl shadow-2xl"
              onClick={e => e.stopPropagation()}
            >
              <button 
                onClick={() => setSelectedImage(null)}
                className="absolute -top-4 -right-4 w-10 h-10 bg-white rounded-full shadow-xl flex items-center justify-center text-slate-600 hover:text-red-500 transition-colors z-10"
              >
                <X size={24} />
              </button>
              <img 
                src={selectedImage} 
                alt="Enlarged Fragment" 
                className="max-w-full max-h-[80vh] rounded-lg"
                referrerPolicy="no-referrer"
              />
            </motion.div>
          </div>
        )}

        {error && (
          <div className="fixed bottom-8 right-8 bg-red-600 text-white p-4 rounded-xl shadow-2xl flex items-center gap-3 animate-in slide-in-from-bottom-4">
            <AlertCircle size={20} />
            <span className="font-medium">{error}</span>
            <button onClick={() => setError(null)} className="p-1 hover:bg-white/20 rounded">
              <X size={16} />
            </button>
          </div>
        )}

        <AnimatePresence>
          {showLogs && (
            <motion.div
              initial={{ y: 300, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 300, opacity: 0 }}
              className="fixed bottom-0 left-0 right-0 bg-slate-900 text-slate-300 h-64 z-40 border-t border-slate-800 shadow-2xl flex flex-col"
            >
              <div className="flex items-center justify-between px-6 py-3 border-b border-slate-800 bg-slate-900/50 backdrop-blur-md sticky top-0">
                <div className="flex items-center gap-2">
                  <Terminal size={16} className="text-indigo-400" />
                  <span className="text-xs font-bold uppercase tracking-wider">Логи системи</span>
                </div>
                <div className="flex items-center gap-4">
                  <button 
                    onClick={() => setLogs([])}
                    className="text-[10px] font-bold text-slate-500 hover:text-slate-300 uppercase tracking-wider transition-colors"
                  >
                    Очистити
                  </button>
                  <button 
                    onClick={() => setShowLogs(false)}
                    className="text-slate-500 hover:text-white transition-colors"
                  >
                    <X size={18} />
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-4 font-mono text-[11px] space-y-1 custom-scrollbar">
                {logs.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-slate-600 italic">
                    Логи порожні...
                  </div>
                ) : (
                  logs.map((log) => (
                    <div key={log.id} className="flex gap-3 hover:bg-white/5 p-1 rounded transition-colors group">
                      <span className="text-slate-600 shrink-0">[{new Date(log.timestamp).toLocaleTimeString()}]</span>
                      <span className={cn(
                        "shrink-0 font-bold w-12",
                        log.level === 'error' ? "text-red-400" : 
                        log.level === 'warn' ? "text-amber-400" : 
                        "text-indigo-400"
                      )}>
                        {log.level.toUpperCase()}
                      </span>
                      <span className="text-slate-300 break-all group-hover:text-white">{log.message}</span>
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
