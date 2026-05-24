export type ColumnRole =
  | 'none'
  | 'order_no'
  | 'case_no'
  | 'title'
  | 'year_range'
  | 'date_start'
  | 'date_end'
  | 'page_count'
  | 'notes';

export interface TableColumn {
  id: string;
  label: string;
  role?: ColumnRole;
}

// --- Бейджі (досягнення) ---
// Критерій здобуття бейджа. Декларативний — додати новий бейдж наявного типу
// = лише правка config.badges; новий тип критерію потребує правки движка (badges.ts).
export type BadgeCriteria =
  | { type: 'total_points'; threshold: number } // накопичені бали ≥ threshold
  | { type: 'cases_total'; threshold: number }   // опрацьовано справ за весь час ≥ threshold
  | { type: 'day_count'; threshold: number };     // справ за один день ≥ threshold

export interface BadgeDef {
  id: string;          // стабільний ключ — НЕ змінювати після релізу (зберігається в БД)
  title: string;       // коротка назва відзнаки (показуємо лише після отримання)
  text: string;        // підпис на картці отриманого бейджа
  image: string;       // ім'я файлу в api/telegram/badges/
  criteria: BadgeCriteria;
}

export interface LogEntry {
  id: string;
  timestamp: number;
  level: 'info' | 'warn' | 'error';
  message: string;
}

export interface PdfFile {
  id: string;
  name: string;
  url?: string;
  isLocal: boolean;
  handle?: FileSystemFileHandle;
  pageRange?: string;
}

export interface Project {
  id: string;
  name: string;
  pdfUrls: string[]; // Deprecated, using files instead
  files?: PdfFile[];
  localPdfs?: { id: string; name: string; handle?: FileSystemFileHandle }[]; // Deprecated
  pageRange?: string; // Global default
  googleSheetsId?: string;
  googleSheetsSheetName?: string;
  googleSheetsTokens?: any;
  keywords: string[];
  tableStructure: TableColumn[];
  scenario: 'search' | 'full';
  results: ArchivalRecord[];
  processingStatus?: ProcessingStatus[];
  errorBehavior?: 'stop' | 'continue';
  logs?: LogEntry[];
  createdAt: number;
}

export interface ArchivalRecord {
  id: string;
  projectId: string;
  pdfUrl: string;
  pageNumber: number;
  data: Record<string, string>;
  tags?: string[];
  fragmentImage?: string; // Base64 fragment
}

export interface PageStatus {
  pageNumber: number;
  status: 'pending' | 'processing' | 'completed' | 'error';
  progress: number;
  message?: string;
}

export interface ProcessingStatus {
  pdfUrl: string;
  status: 'pending' | 'downloading' | 'processing' | 'completed' | 'error';
  progress: number;
  message?: string;
  pages?: PageStatus[];
}
