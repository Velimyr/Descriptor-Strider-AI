import { ColumnRole, TableColumn } from '../types';

export const COLUMN_ROLE_LABELS: Record<ColumnRole, string> = {
  none: 'Без ролі',
  order_no: 'Порядковий номер',
  case_no: 'Номер справи',
  title: 'Назва справи',
  year_range: 'Роки',
  date_start: 'Коли почато',
  date_end: 'Коли закінчено',
  page_count: 'Кількість аркушів',
  notes: 'Примітка',
};

export const COLUMN_ROLE_OPTIONS: ColumnRole[] = [
  'none',
  'order_no',
  'case_no',
  'title',
  'year_range',
  'date_start',
  'date_end',
  'page_count',
  'notes',
];

export const LEGACY_DEFAULT_COLUMNS: TableColumn[] = [
  { id: 'order_no', label: 'Порядковий номер', role: 'order_no' },
  { id: 'case_no', label: 'Номер справи', role: 'case_no' },
  { id: 'title', label: 'Назва справи', role: 'title' },
  { id: 'years', label: 'Роки', role: 'year_range' },
  { id: 'pages', label: 'Кількість сторінок', role: 'page_count' },
  { id: 'notes', label: 'Примітки', role: 'notes' },
];

const LEGACY_ROLE_BY_ID: Partial<Record<string, ColumnRole>> = {
  order_no: 'order_no',
  case_no: 'case_no',
  title: 'title',
  years: 'year_range',
  pages: 'page_count',
  notes: 'notes',
};

const normalizeText = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]+/gu, '')
    .replace(/\s+/g, ' ');

const isColumnRole = (value: string | undefined): value is ColumnRole =>
  !!value && COLUMN_ROLE_OPTIONS.includes(value as ColumnRole);

export const generateColumnId = () =>
  `col_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;

const isStableColumnId = (value: string) => /^col_[a-z0-9]+$/i.test(value);

export const inferColumnRole = (column: Partial<TableColumn>): ColumnRole => {
  if (isColumnRole(column.role)) {
    return column.role;
  }

  const normalizedLabel = normalizeText(column.label || '');

  if (normalizedLabel.includes('порядков')) return 'order_no';
  if (normalizedLabel.includes('номер справ')) return 'case_no';
  if (normalizedLabel.includes('назва')) return 'title';
  if (normalizedLabel.includes('коли поч') || normalizedLabel.includes('дата поч')) return 'date_start';
  if (normalizedLabel.includes('коли зак') || normalizedLabel.includes('дата зак')) return 'date_end';
  if (normalizedLabel === 'роки' || normalizedLabel.includes('рік') || normalizedLabel.includes('рок')) return 'year_range';
  if (
    normalizedLabel.includes('аркуш') ||
    normalizedLabel.includes('сторін') ||
    normalizedLabel.includes('лист')
  ) {
    return 'page_count';
  }
  if (normalizedLabel.includes('приміт')) return 'notes';

  const legacyRole = column.id ? LEGACY_ROLE_BY_ID[column.id] : undefined;
  return legacyRole || 'none';
};

export const getColumnLabel = (column: TableColumn, index: number) => {
  const trimmed = column.label.trim();
  if (trimmed) return trimmed;

  if (column.role && column.role !== 'none') {
    return COLUMN_ROLE_LABELS[column.role];
  }

  return `Колонка ${index + 1}`;
};

export const createColumn = (label = 'Нова колонка', role: ColumnRole = 'none'): TableColumn => ({
  id: generateColumnId(),
  label,
  role,
});

export const createDefaultColumns = (): TableColumn[] => [
  createColumn(LEGACY_DEFAULT_COLUMNS[0].label, 'order_no'),
  createColumn(LEGACY_DEFAULT_COLUMNS[1].label, 'case_no'),
  createColumn(LEGACY_DEFAULT_COLUMNS[2].label, 'title'),
  createColumn(LEGACY_DEFAULT_COLUMNS[3].label, 'year_range'),
  createColumn(LEGACY_DEFAULT_COLUMNS[4].label, 'page_count'),
  createColumn(LEGACY_DEFAULT_COLUMNS[5].label, 'notes'),
];

export const normalizeTableStructure = (columns?: TableColumn[]): TableColumn[] => {
  const source = Array.isArray(columns) && columns.length > 0 ? columns : createDefaultColumns();
  const seenIds = new Set<string>();
  const seenRoles = new Set<ColumnRole>();

  return source.map((column) => {
    const candidateId = (column?.id || '').trim();
    let id = isStableColumnId(candidateId) ? candidateId : generateColumnId();
    let role = inferColumnRole(column);

    while (seenIds.has(id)) {
      id = generateColumnId();
    }

    if (role !== 'none') {
      if (seenRoles.has(role)) {
        role = 'none';
      } else {
        seenRoles.add(role);
      }
    }

    seenIds.add(id);

    return {
      id,
      label: column?.label ?? '',
      role,
    };
  });
};
