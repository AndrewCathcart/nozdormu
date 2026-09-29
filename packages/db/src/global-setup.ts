import type { TestProject } from "vitest/node";
import { createTemplateDatabase, dropDatabase, dropStaleTestDatabases } from "./testing.ts";

declare module "vitest" {
  export interface ProvidedContext {
    templateDatabase: string;
  }
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  await dropStaleTestDatabases(new Date());
  const template = await createTemplateDatabase();
  project.provide("templateDatabase", template);
  return () => dropDatabase(template);
}
