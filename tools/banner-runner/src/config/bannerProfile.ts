import { readFile } from "node:fs/promises";

import { z } from "zod";

const selectorSchema = z.object({
  type: z.enum(["css", "xpath", "text", "label", "role", "placeholder", "testId"]),
  value: z.string().min(1),
  name: z.string().optional(),
  exact: z.boolean().optional()
});

const frameRefSchema = z.object({
  name: z.string().optional(),
  urlIncludes: z.string().optional()
});

const bannerProfileSchema = z.object({
  login: z.object({
    url: z.string().url(),
    framePath: z.array(frameRefSchema).default([]),
    username: z.array(selectorSchema).min(1),
    usernameSubmit: z.array(selectorSchema).optional(),
    password: z.array(selectorSchema).min(1),
    passwordSubmit: z.array(selectorSchema).optional(),
    staySignedInDecline: z.array(selectorSchema).optional(),
    submit: z.array(selectorSchema).min(1),
    successIndicators: z.array(selectorSchema).default([])
  }),
  navigation: z.object({
    searchUrl: z.string().url().optional(),
    framePath: z.array(frameRefSchema).default([]),
    menuPath: z.array(z.array(selectorSchema)).default([])
  }),
  lookup: z.object({
    formFramePath: z.array(frameRefSchema).default([]),
    actionFramePath: z.array(frameRefSchema).default([]),
    resultsFramePath: z.array(frameRefSchema).default([]),
    preSearchWaitMs: z.number().int().min(0).default(250),
    postSearchWaitMs: z.number().int().min(0).default(1000),
    nrcInput: z.array(selectorSchema).min(1),
    periodInput: z.array(selectorSchema).optional(),
    searchButton: z.array(selectorSchema).optional(),
    resetButton: z.array(selectorSchema).optional(),
    restartButton: z.array(selectorSchema).optional(),
    postSearchActions: z.array(z.array(selectorSchema)).default([]),
    resultsContainer: z.array(selectorSchema).optional(),
    noResultsIndicators: z.array(selectorSchema).default([]),
    noTeacherIndicators: z.array(selectorSchema).default([]),
    teacherName: z.array(selectorSchema).optional(),
    teacherId: z.array(selectorSchema).optional(),
    programName: z.array(selectorSchema).optional(),
    statusText: z.array(selectorSchema).optional(),
    additionalFields: z.record(z.string(), z.array(selectorSchema)).default({})
  })
});

export type SelectorDefinition = z.infer<typeof selectorSchema>;
export type FrameRef = z.infer<typeof frameRefSchema>;
export type BannerProfile = z.infer<typeof bannerProfileSchema>;

export async function loadBannerProfile(profilePath: string): Promise<BannerProfile> {
  const raw = await readFile(profilePath, "utf8");
  const json = JSON.parse(raw) as unknown;
  return bannerProfileSchema.parse(json);
}
