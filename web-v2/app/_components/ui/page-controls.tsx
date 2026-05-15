'use client';

export const PAGE_SIZE_OPTIONS = [50, 100, 200, 500, 1000] as const;
export type PageSizeOption = (typeof PAGE_SIZE_OPTIONS)[number];

type PaginationControlsProps = {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  pageSize: PageSizeOption;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: PageSizeOption) => void;
  label?: string;
};

export function PaginationControls({
  currentPage,
  totalPages,
  totalItems,
  pageSize,
  onPageChange,
  onPageSizeChange,
  label = 'registros',
}: PaginationControlsProps) {
  if (totalItems === 0) return null;

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, padding: '10px 0 2px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ color: 'var(--muted)', fontSize: 13 }}>
          Página {currentPage} de {totalPages} · {totalItems.toLocaleString('es')} {label}
        </span>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, color: 'var(--muted)' }}>
          Mostrar
          <select
            value={pageSize}
            onChange={(e) => {
              onPageSizeChange(Number(e.target.value) as PageSizeOption);
              onPageChange(1);
            }}
            style={{
              fontSize: 13,
              padding: '2px 6px',
              borderRadius: 6,
              border: '1px solid var(--line)',
              background: 'var(--surface)',
              color: 'var(--ink)',
              cursor: 'pointer',
            }}
          >
            {PAGE_SIZE_OPTIONS.map((size) => (
              <option key={size} value={size}>{size}</option>
            ))}
          </select>
        </label>
      </div>

      <div style={{ display: 'flex', gap: 4 }}>
        <PagBtn onClick={() => onPageChange(1)} disabled={currentPage === 1} label="«" />
        <PagBtn onClick={() => onPageChange(currentPage - 1)} disabled={currentPage === 1} label="‹ Ant" />
        <PagBtn onClick={() => onPageChange(currentPage + 1)} disabled={currentPage === totalPages} label="Sig ›" />
        <PagBtn onClick={() => onPageChange(totalPages)} disabled={currentPage === totalPages} label="»" />
      </div>
    </div>
  );
}

function PagBtn({ onClick, disabled, label }: { onClick: () => void; disabled: boolean; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '3px 10px',
        fontSize: 13,
        borderRadius: 6,
        border: '1px solid var(--line)',
        background: disabled ? 'var(--bg)' : 'var(--surface)',
        color: disabled ? 'var(--muted)' : 'var(--primary)',
        cursor: disabled ? 'default' : 'pointer',
        fontWeight: 500,
      }}
    >
      {label}
    </button>
  );
}
