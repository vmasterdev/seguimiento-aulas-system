export const SUPPORTED_MOMENTS = ['MD1', 'MD2', '1', 'INTER', 'RM1', 'RM2'] as const;

export type SupportedMoment = (typeof SUPPORTED_MOMENTS)[number];

export const TEACHER_BOOKING_URL =
  'https://outlook.office.com/book/CampusVirtual1@uniminuto.edu/s/y4TJLlHIjkmqPphvip1Piw2?ismsaljsauthenabled';

export const CAMPUS_VIRTUAL_COMMUNICADO_URL = 'https://comunicado2026.netlify.app/';
