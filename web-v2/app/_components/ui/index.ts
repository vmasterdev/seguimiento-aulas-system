/**
 * Design System — Seguimiento de Aulas
 *
 * Importa todos los componentes UI desde aquí:
 *   import { Button, Field, StatusPill, AlertBox, PageHero, StatsGrid, DataTable, FilterBar } from '../../_components/ui';
 *
 * Si mañana quieres cambiar el look de TODO el sistema,
 * edita el componente correspondiente en esta carpeta.
 */
export { Button } from './button';
export { Field } from './field';
export { StatusPill } from './status-pill';
export type { PillTone } from './status-pill';
export { AlertBox } from './alert-box';
export type { AlertTone } from './alert-box';
export { PageHero } from './page-hero';
export { StatsGrid } from './stats-grid';
export { DataTable } from './data-table';
export { VirtualTable } from './virtual-table';
export type { VirtualTableColumn } from './virtual-table';
export { FilterBar } from './filter-bar';
export { Modal } from './modal';
export type { ModalSize, ModalProps } from './modal';
export { ToastProvider, useToast } from './toast';
export type { ToastTone, ToastOptions } from './toast';
export { ConfirmProvider, useConfirm } from './confirm';
export type { ConfirmOptions } from './confirm';
export { AppProviders } from './app-providers';
export { PaginationControls, PAGE_SIZE_OPTIONS } from './page-controls';
export type { PageSizeOption } from './page-controls';
