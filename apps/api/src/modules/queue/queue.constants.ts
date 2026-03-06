export const MOODLE_CLASSIFY_QUEUE = 'moodle.classify';

export type MoodleClassifyJob = {
  courseId: string;
  periodId: string;
  nrc: string;
};
